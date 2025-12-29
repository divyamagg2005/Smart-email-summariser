import json
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
import numpy as np
from scipy import stats
import sys

# Redirect stdout to file
original_stdout = sys.stdout
sys.stdout = open('metric analysis/analysis_report.txt', 'w', encoding='utf-8')

# Load the metrics data
with open('metric analysis/metrics.json', 'r') as f:
    data = json.load(f)

df = pd.DataFrame(data)

print("="*80)
print("EMAIL SUMMARIZATION SYSTEM PERFORMANCE ANALYSIS")
print("="*80)
print()

# ============================================================================
# 1. DATASET OVERVIEW
# ============================================================================
print("1. DATASET OVERVIEW")
print("-" * 80)

total_runs = len(df)
successful_runs = df['success'].sum()
failed_runs = total_runs - successful_runs

print(f"Total number of runs: {total_runs}")
print(f"Successful runs: {successful_runs} ({successful_runs/total_runs*100:.1f}%)")
print(f"Failed runs: {failed_runs} ({failed_runs/total_runs*100:.1f}%)")
print()

print("Distribution of batchSize values:")
batch_dist = df['batchSize'].value_counts().sort_index()
for batch_size, count in batch_dist.items():
    print(f"  batchSize={batch_size}: {count} runs ({count/total_runs*100:.1f}%)")
print()

# Cache identification based on tokensTotal
cache_served = (df['tokensTotal'] == 0).sum()
llm_invoked = (df['tokensTotal'] > 0).sum()

print(f"Cache-served runs (tokensTotal == 0): {cache_served} ({cache_served/total_runs*100:.1f}%)")
print(f"LLM-invoked runs (tokensTotal > 0): {llm_invoked} ({llm_invoked/total_runs*100:.1f}%)")
print()

# ============================================================================
# 2. SINGLE vs MULTI-EMAIL ANALYSIS
# ============================================================================
print("2. SINGLE vs MULTI-EMAIL ANALYSIS")
print("-" * 80)

# Define single and multi email runs
df['category'] = df['batchSize'].apply(lambda x: 'single' if x == 1 else 'multi')

single_email = df[df['category'] == 'single']
multi_email = df[df['category'] == 'multi']

print(f"Single-email runs (batchSize == 1): {len(single_email)}")
print(f"Multi-email runs (batchSize > 1): {len(multi_email)}")
print()

# Analysis for BOTH categories using ONLY tokensTotal > 0 runs
for category_name, category_df in [('SINGLE-EMAIL', single_email), ('MULTI-EMAIL', multi_email)]:
    print(f"{category_name} INTERACTIONS:")
    
    # LLM-invoked runs only for performance metrics
    llm_runs = category_df[category_df['tokensTotal'] > 0]
    
    if len(llm_runs) > 0:
        print(f"  LLM-invoked runs: {len(llm_runs)}")
        print(f"  Average latency: {llm_runs['latencyMs'].mean():.2f} ms")
        print(f"  Median latency: {llm_runs['latencyMs'].median():.2f} ms")
        print(f"  Min latency: {llm_runs['latencyMs'].min():.2f} ms")
        print(f"  Max latency: {llm_runs['latencyMs'].max():.2f} ms")
        print(f"  Average throughput: {llm_runs['throughput'].mean():.4f} emails/sec")
        
        failures = len(llm_runs[llm_runs['success'] == False])
        print(f"  Failure rate: {failures}/{len(llm_runs)} ({failures/len(llm_runs)*100:.1f}%)")
    else:
        print(f"  LLM-invoked runs: 0 (no performance metrics available)")
    
    # Cache-served rate for all runs
    cache_rate = (category_df['tokensTotal'] == 0).sum()
    print(f"  Cache-served rate: {cache_rate}/{len(category_df)} ({cache_rate/len(category_df)*100:.1f}%)")
    print()

# ============================================================================
# 3. CACHE IMPACT ANALYSIS
# ============================================================================
print("3. CACHE IMPACT ANALYSIS")
print("-" * 80)

# Classify runs
df['cache_status'] = df['tokensTotal'].apply(lambda x: 'cache-served' if x == 0 else 'llm-invoked')

print("Overall cache statistics:")
print(f"  Cache-served: {(df['cache_status'] == 'cache-served').sum()} runs")
print(f"  LLM-invoked: {(df['cache_status'] == 'llm-invoked').sum()} runs")
print()

# Cache impact by category
for category_name, category_df in [('Single-email', single_email), ('Multi-email', multi_email)]:
    cache_count = (category_df['tokensTotal'] == 0).sum()
    print(f"{category_name} cache-served percentage: {cache_count}/{len(category_df)} ({cache_count/len(category_df)*100:.1f}%)")

print()

# Latency comparison for LLM-invoked runs only
llm_invoked_df = df[df['tokensTotal'] > 0]

if len(llm_invoked_df) > 0:
    print("Latency distribution for LLM-invoked runs:")
    print(f"  Mean: {llm_invoked_df['latencyMs'].mean():.2f} ms")
    print(f"  Median: {llm_invoked_df['latencyMs'].median():.2f} ms")
    print(f"  Std: {llm_invoked_df['latencyMs'].std():.2f} ms")
    print()

# ============================================================================
# 4. QUEUE BEHAVIOR ANALYSIS
# ============================================================================
print("4. QUEUE BEHAVIOR ANALYSIS")
print("-" * 80)

# Use only LLM-invoked runs
llm_df = df[df['tokensTotal'] > 0].copy()

if len(llm_df) > 0:
    queued_runs = llm_df[llm_df['queueWaitMs'] > 0]
    no_queue_runs = llm_df[llm_df['queueWaitMs'] == 0]
    
    print(f"Runs with queue wait (queueWaitMs > 0): {len(queued_runs)}")
    print(f"Runs without queue wait (queueWaitMs == 0): {len(no_queue_runs)}")
    print()
    
    if len(queued_runs) > 0:
        print(f"Average queueWaitMs (when > 0): {queued_runs['queueWaitMs'].mean():.2f} ms")
        print(f"Average latency when queueWaitMs > 0: {queued_runs['latencyMs'].mean():.2f} ms")
    
    if len(no_queue_runs) > 0:
        print(f"Average latency when queueWaitMs == 0: {no_queue_runs['latencyMs'].mean():.2f} ms")
    
    print()
    
    # Correlation - only for runs where queueWaitMs > 0
    if len(queued_runs) > 1:
        correlation = queued_runs[['queueWaitMs', 'latencyMs']].corr().iloc[0, 1]
        print(f"Correlation coefficient (queueWaitMs vs latencyMs, for queueWaitMs > 0): {correlation:.4f}")
    else:
        print("Correlation cannot be computed: fewer than 2 runs with queueWaitMs > 0")
    print()
else:
    print("No LLM-invoked runs available for queue analysis")
    print()

# ============================================================================
# 5. MULTI-EMAIL SCALING BEHAVIOR
# ============================================================================
print("5. MULTI-EMAIL SCALING BEHAVIOR")
print("-" * 80)

# Use only LLM-invoked runs
llm_df = df[df['tokensTotal'] > 0].copy()

if len(llm_df) > 0:
    print("Performance by batchSize (LLM-invoked runs only):")
    print()
    
    batch_sizes = sorted(llm_df['batchSize'].unique())
    
    scaling_results = []
    
    for batch_size in batch_sizes:
        batch_runs = llm_df[llm_df['batchSize'] == batch_size]
        all_batch_runs = df[df['batchSize'] == batch_size]
        
        failures = len(batch_runs[batch_runs['success'] == False])
        batch_cache_served = (all_batch_runs['tokensTotal'] == 0).sum()

        
        print(f"batchSize = {batch_size}:")
        print(f"  Number of LLM-invoked runs: {len(batch_runs)}")
        print(f"  Average latency: {batch_runs['latencyMs'].mean():.2f} ms")
        print(f"  Average throughput: {batch_runs['throughput'].mean():.4f} emails/sec")
        
        if len(batch_runs) > 0:
            print(f"  Failure rate: {failures}/{len(batch_runs)} ({failures/len(batch_runs)*100:.1f}%)")
        else:
            print(f"  Failure rate: N/A (no LLM-invoked runs)")
        
        print(f"  Cache-served (all runs): {batch_cache_served}/{len(all_batch_runs)} ({batch_cache_served/len(all_batch_runs)*100:.1f}%)")
        print()
        
        scaling_results.append({
            'batchSize': batch_size,
            'avg_latency': batch_runs['latencyMs'].mean(),
            'avg_throughput': batch_runs['throughput'].mean(),
            'count': len(batch_runs)
        })
    
    scaling_df = pd.DataFrame(scaling_results)
else:
    print("No LLM-invoked runs available for scaling analysis")
    print()
    scaling_df = pd.DataFrame()

# ============================================================================
# 6. TOKEN USAGE ANALYSIS
# ============================================================================
print("6. TOKEN USAGE ANALYSIS")
print("-" * 80)

token_runs = df[df['tokensTotal'] > 0]

if len(token_runs) > 0:
    print(f"Runs with token usage: {len(token_runs)}")
    print(f"Average tokensPerEmail: {token_runs['tokensPerEmail'].mean():.2f}")
    print(f"Median tokensPerEmail: {token_runs['tokensPerEmail'].median():.2f}")
    print(f"Max tokensPerEmail: {token_runs['tokensPerEmail'].max():.2f}")
    print(f"Min tokensPerEmail: {token_runs['tokensPerEmail'].min():.2f}")
    print()
    
    print("Token usage distribution quartiles:")
    print(f"  25th percentile: {token_runs['tokensPerEmail'].quantile(0.25):.2f}")
    print(f"  50th percentile: {token_runs['tokensPerEmail'].quantile(0.50):.2f}")
    print(f"  75th percentile: {token_runs['tokensPerEmail'].quantile(0.75):.2f}")
    print()
else:
    print("No runs with token usage available")
    print()

# ============================================================================
# 7. ERROR & FAILURE ANALYSIS
# ============================================================================
print("7. ERROR & FAILURE ANALYSIS")
print("-" * 80)

failed_runs = df[df['success'] == False]

print(f"Total failed runs: {len(failed_runs)}")
print()

if len(failed_runs) > 0:
    print("Error frequency:")
    error_counts = failed_runs['error'].value_counts()
    for error, count in error_counts.items():
        print(f"  '{error}': {count} occurrences")
    print()
    
    # Categorize errors
    rate_limit_errors = failed_runs[failed_runs['error'].str.contains('429', na=False)]
    payload_errors = failed_runs[failed_runs['error'].str.contains('413', na=False)]
    other_errors = failed_runs[~failed_runs['error'].str.contains('429|413', na=False)]
    
    print("Error categorization:")
    print(f"  Rate-limit errors (HTTP 429): {len(rate_limit_errors)}")
    print(f"  Payload-size errors (HTTP 413): {len(payload_errors)}")
    print(f"  Other failures: {len(other_errors)}")
    print()
    
    # Correlation with batchSize
    print("Failure correlation with batchSize:")
    print(f"  Average batchSize for failures: {failed_runs['batchSize'].mean():.2f}")
    print(f"  Average batchSize for successes: {df[df['success'] == True]['batchSize'].mean():.2f}")
    print()
    
    # Correlation with queueWaitMs
    if failed_runs['queueWaitMs'].notna().any():
        print("Failure correlation with queueWaitMs:")
        print(f"  Average queueWaitMs for failures: {failed_runs['queueWaitMs'].mean():.2f} ms")
        success_runs = df[df['success'] == True]
        if len(success_runs) > 0:
            print(f"  Average queueWaitMs for successes: {success_runs['queueWaitMs'].mean():.2f} ms")
        print()
else:
    print("No failed runs in dataset")
    print()

# ============================================================================
# 8. VISUALIZATIONS
# ============================================================================
print("8. GENERATING VISUALIZATIONS")
print("-" * 80)

# Set style
sns.set_style("whitegrid")
plt.rcParams['figure.figsize'] = (12, 8)

# Create figure with subplots
fig = plt.figure(figsize=(16, 12))

# Plot 1: Histogram of latencyMs (tokensTotal > 0 only)
ax1 = plt.subplot(3, 3, 1)
llm_only = df[df['tokensTotal'] > 0]
if len(llm_only) > 0:
    ax1.hist(llm_only['latencyMs'], bins=20, edgecolor='black', alpha=0.7)
    ax1.set_xlabel('Latency (ms)')
    ax1.set_ylabel('Frequency')
    ax1.set_title('Latency Distribution (LLM-invoked runs only)')
    ax1.set_xscale('log')
    ax1.grid(True, alpha=0.3)

# Plot 2: Scatter - batchSize vs latencyMs
ax2 = plt.subplot(3, 3, 2)
if len(llm_only) > 0:
    ax2.scatter(llm_only['batchSize'], llm_only['latencyMs'], alpha=0.6)
    ax2.set_xlabel('User-selected Email Count (batchSize)')
    ax2.set_ylabel('Latency (ms)')
    ax2.set_title('User-selected Email Count vs Latency (LLM-invoked)')
    ax2.set_yscale('log')
    ax2.grid(True, alpha=0.3)

# Plot 3: Scatter - queueWaitMs vs latencyMs
ax3 = plt.subplot(3, 3, 3)
if len(llm_only) > 0:
    ax3.scatter(llm_only['queueWaitMs'], llm_only['latencyMs'], alpha=0.6, c='orange')
    ax3.set_xlabel('Queue Wait Time (ms)')
    ax3.set_ylabel('Latency (ms)')
    ax3.set_title('Queue Wait vs Latency (LLM-invoked)')
    ax3.set_yscale('log')
    ax3.grid(True, alpha=0.3)

# Plot 4: Box plot - latencyMs grouped by single vs multi email
ax4 = plt.subplot(3, 3, 4)
llm_with_category = llm_only.copy()
llm_with_category['category'] = llm_with_category['batchSize'].apply(lambda x: 'Single' if x == 1 else 'Multi')
if len(llm_with_category) > 0:
    llm_with_category.boxplot(column='latencyMs', by='category', ax=ax4)
    ax4.set_xlabel('Email Category')
    ax4.set_ylabel('Latency (ms)')
    ax4.set_title('Latency: Single vs Multi-Email (LLM-invoked)')
    plt.sca(ax4)
    plt.xticks([1, 2], ['Single', 'Multi'])

# Plot 5: Average latency per batchSize
ax5 = plt.subplot(3, 3, 5)
if len(scaling_df) > 0:
    ax5.plot(scaling_df['batchSize'], scaling_df['avg_latency'], marker='o', linewidth=2)
    ax5.set_xlabel('User-selected Email Count (batchSize)')
    ax5.set_ylabel('Average Latency (ms)')
    ax5.set_title('Average Latency by User-selected Email Count (LLM-invoked)')
    ax5.set_yscale('log')
    ax5.grid(True, alpha=0.3)

# Plot 6: Average throughput per batchSize
ax6 = plt.subplot(3, 3, 6)
if len(scaling_df) > 0:
    ax6.plot(scaling_df['batchSize'], scaling_df['avg_throughput'], marker='o', color='green', linewidth=2)
    ax6.set_xlabel('User-selected Email Count (batchSize)')
    ax6.set_ylabel('Average Throughput (emails/sec)')
    ax6.set_title('Average Throughput by User-selected Email Count (LLM-invoked)')
    ax6.grid(True, alpha=0.3)

# Plot 7: Scatter - tokensPerEmail vs latencyMs
ax7 = plt.subplot(3, 3, 7)
if len(token_runs) > 0:
    ax7.scatter(token_runs['tokensPerEmail'], token_runs['latencyMs'], alpha=0.6, c='red')
    ax7.set_xlabel('Tokens Per Email')
    ax7.set_ylabel('Latency (ms)')
    ax7.set_title('Token Usage vs Latency')
    ax7.set_yscale('log')
    ax7.grid(True, alpha=0.3)

# Plot 8: Cache hit rate by category
ax8 = plt.subplot(3, 3, 8)
cache_stats = []
for cat in ['single', 'multi']:
    cat_df = df[df['category'] == cat]
    cache_rate = (cat_df['tokensTotal'] == 0).sum() / len(cat_df) * 100
    cache_stats.append({'category': cat.capitalize(), 'cache_rate': cache_rate})
cache_stats_df = pd.DataFrame(cache_stats)
ax8.bar(cache_stats_df['category'], cache_stats_df['cache_rate'], color=['blue', 'orange'])
ax8.set_xlabel('Email Category')
ax8.set_ylabel('Cache-Served Rate (%)')
ax8.set_title('Cache Effectiveness by Category')
ax8.grid(True, alpha=0.3, axis='y')

# Plot 9: Success vs Failure distribution
ax9 = plt.subplot(3, 3, 9)
success_counts = df['success'].value_counts()
labels = ['Success' if idx else 'Failure' for idx in success_counts.index]
ax9.pie(success_counts, labels=labels, autopct='%1.1f%%', colors=['green', 'red'])
ax9.set_title('Overall Success Rate')

plt.tight_layout()
plt.savefig('metric analysis/performance_analysis.png', dpi=300, bbox_inches='tight')
print("Visualizations saved to 'performance_analysis.png'")
print()

# ============================================================================
# 9. FINAL PRINTED SUMMARY
# ============================================================================
print("="*80)
print("FINAL SUMMARY")
print("="*80)
print()

# Single vs multi-email comparison
single_llm = single_email[single_email['tokensTotal'] > 0]
multi_llm = multi_email[multi_email['tokensTotal'] > 0]

print("SINGLE vs MULTI-EMAIL LATENCY COMPARISON:")
if len(single_llm) > 0 and len(multi_llm) > 0:
    print(f"  Single-email average latency: {single_llm['latencyMs'].mean():.2f} ms")
    print(f"  Multi-email average latency: {multi_llm['latencyMs'].mean():.2f} ms")
    diff = multi_llm['latencyMs'].mean() - single_llm['latencyMs'].mean()
    print(f"  Difference: {diff:.2f} ms ({diff/single_llm['latencyMs'].mean()*100:.1f}% higher for multi-email)")
elif len(single_llm) > 0:
    print(f"  Single-email average latency: {single_llm['latencyMs'].mean():.2f} ms")
    print(f"  Multi-email: insufficient LLM-invoked data")
elif len(multi_llm) > 0:
    print(f"  Single-email: insufficient LLM-invoked data")
    print(f"  Multi-email average latency: {multi_llm['latencyMs'].mean():.2f} ms")
else:
    print("  Insufficient LLM-invoked data for comparison")
print()

# Cache effectiveness
print("CACHE EFFECTIVENESS:")
cache_single = (single_email['tokensTotal'] == 0).sum() / len(single_email) * 100
cache_multi = (multi_email['tokensTotal'] == 0).sum() / len(multi_email) * 100
print(f"  Single-email cache-served rate: {cache_single:.1f}%")
print(f"  Multi-email cache-served rate: {cache_multi:.1f}%")
print(f"  Overall cache-served rate: {cache_served/total_runs*100:.1f}%")
print("  Caching reduces the number of LLM invocations by serving repeated requests locally")
print()

# Queue impact
print("QUEUEING IMPACT:")
if len(llm_df) > 0:
    queued = llm_df[llm_df['queueWaitMs'] > 0]
    no_queue = llm_df[llm_df['queueWaitMs'] == 0]
    
    if len(queued) > 0 and len(no_queue) > 0:
        print(f"  Average latency with queue wait: {queued['latencyMs'].mean():.2f} ms")
        print(f"  Average latency without queue wait: {no_queue['latencyMs'].mean():.2f} ms")
        print(f"  Queue wait adds: {queued['queueWaitMs'].mean():.2f} ms on average")
        
        if len(queued) > 1:
            corr = queued[['queueWaitMs', 'latencyMs']].corr().iloc[0, 1]
            if corr > 0.7:
                print(f"  Strong positive correlation (r={corr:.3f}) between queue wait and total latency")
            elif corr > 0.4:
                print(f"  Moderate positive correlation (r={corr:.3f}) between queue wait and total latency")
            else:
                print(f"  Weak correlation (r={corr:.3f}) between queue wait and total latency")
            print("  Note: correlation indicates association, not causation")
    
    # Queue-related failures
    if len(failed_runs) > 0:
        failed_with_queue = failed_runs[failed_runs['queueWaitMs'] > 0]
        if len(failed_with_queue) > 0:
            print(f"  {len(failed_with_queue)}/{len(failed_runs)} failures occurred with queue wait")
print()

# Scaling behavior
print("MULTI-EMAIL SCALING BEHAVIOR:")
if len(scaling_df) > 1:
    print(f"  As batchSize increases from {scaling_df['batchSize'].min()} to {scaling_df['batchSize'].max()}:")
    latency_change = scaling_df.iloc[-1]['avg_latency'] - scaling_df.iloc[0]['avg_latency']
    print(f"    Average latency changes by {latency_change:.2f} ms")
    print(f"  This reflects sequential processing of multiple emails in a single user interaction")
else:
    print("  Insufficient data across multiple batchSize values")
print()

# System limitations
print("SYSTEM LIMITATIONS:")
print("  • Sequential execution: All emails are processed one at a time via a queue")
print("  • No parallel processing: batchSize represents user interaction workload, not execution batching")
print("  • Rate limiting: Fixed delay between LLM calls (QUEUE_DELAY_MS = 1800ms)")
print(f"  • Failure modes observed: {len(failed_runs)} failures across {total_runs} runs")
if len(failed_runs) > 0:
    rate_limit = len(failed_runs[failed_runs['error'].str.contains('429', na=False)])
    payload = len(failed_runs[failed_runs['error'].str.contains('413', na=False)])
    if rate_limit > 0:
        print(f"    - Rate limit errors (429): {rate_limit} occurrences")
    if payload > 0:
        print(f"    - Payload size errors (413): {payload} occurrences")

print()
print("="*80)
print("ANALYSIS COMPLETE")
print("="*80)

# Restore stdout
sys.stdout.close()
sys.stdout = original_stdout