# Auto-Planner Workflow

## Overview
This document proposes an automated planning system that intelligently generates `manual_plan.csv` from `processed_content.csv`, reducing manual effort and optimizing content synthesis strategies.

## Development Phases

### Phase 1: Basic Individual Article Processing (SIMPLE - IMPLEMENT NOW)

**Objective**: Automatically create one plan entry per processed article

**Implementation**:
```javascript
// scripts/auto_planner/1_basic_planner.js
```

**Algorithm**:
```javascript
async function generateBasicPlan() {
  // 1. Read processed_content.csv
  const processedContent = await readProcessedContent();
  
  // 2. For each valid article (length > 500 chars, status = 'success'):
  const planEntries = [];
  for (const article of processedContent) {
    if (isValidArticle(article)) {
      planEntries.push({
        processed_ids: article.processed_id,
        subject: generateSubject(article),  // Extract from title/content
        provider: 'openai',  // or 'gemini' based on config
        model: 'gpt-4o-mini',
        profile: selectProfile(article)  // Choose based on content type
      });
    }
  }
  
  // 3. Write to manual_plan.csv
  await writePlanCsv(planEntries);
}
```

**Subject Generation Logic**:
```javascript
function generateSubject(article) {
  // Strategy 1: Use article title if available and meaningful
  if (article.title && article.title.length > 10 && !isGeneric(article.title)) {
    return cleanTitle(article.title);
  }
  
  // Strategy 2: Extract first sentence if title is generic
  const firstSentence = extractFirstSentence(article.content);
  if (firstSentence.length < 100) {
    return firstSentence;
  }
  
  // Strategy 3: Use AI to generate subject
  return await aiGenerateSubject(article.content.substring(0, 500));
}
```

**Profile Selection Logic**:
```javascript
function selectProfile(article) {
  const keywords = extractKeywords(article.content);
  
  // Business/finance content
  if (containsAny(keywords, ['investment', 'market', 'stock', 'finance'])) {
    return 'sns_draft_v1';  // Business-focused
  }
  
  // Academic/research content
  if (containsAny(keywords, ['study', 'research', 'university', 'science'])) {
    return 'sns_draft_v1';  // Research-focused
  }
  
  // Default
  return 'sns_draft_v1';
}
```

**Output**: `data/3_plans/auto_generated_plan.csv`

**Complexity**: ⭐ (Very Simple - Can implement immediately)

---

### Phase 2: Intelligent Synthesis Strategy (COMPLEX)

**Objective**: Group related articles and create synthesized content plans

#### Phase 2.1: Content Similarity Analysis

**Implementation**:
```javascript
// scripts/auto_planner/2_1_similarity_analyzer.js
```

**Process**:
1. **Vectorize Content**:
   - Use sentence embeddings (e.g., OpenAI embeddings, Universal Sentence Encoder)
   - Create vector representations of each article
   
2. **Calculate Similarity Matrix**:
   - Compute cosine similarity between all pairs
   - Store in `data/auto_planner/similarity_matrix.csv`

3. **Identify Clusters**:
   ```javascript
   // Using hierarchical clustering or K-means
   const clusters = clusterArticles(similarityMatrix, threshold=0.7);
   ```

**Complexity**: ⭐⭐⭐ (Moderate - requires ML libraries)

#### Phase 2.2: Topic Modeling

**Implementation**:
```javascript
// scripts/auto_planner/2_2_topic_modeler.js
```

**Techniques**:
- LDA (Latent Dirichlet Allocation)
- NMF (Non-negative Matrix Factorization)
- BERTopic for modern topic modeling

**Output**:
```csv
processed_id,primary_topic,topic_probability,topic_keywords
1,healthcare,0.85,"alzheimer blood test diagnosis medical"
2,computer_science,0.92,"algorithm automation game simulation"
3,business,0.78,"startup saas revenue growth"
```

**Complexity**: ⭐⭐⭐⭐ (Complex - requires NLP expertise)

#### Phase 2.3: Smart Grouping Engine

**Implementation**:
```javascript
// scripts/auto_planner/2_3_smart_grouper.js
```

**Strategies**:

1. **Topic-Based Grouping**:
   ```javascript
   // Group articles with same primary topic
   function groupByTopic(articles, topics) {
     const groups = {};
     for (const article of articles) {
       const topic = topics.find(t => t.processed_id === article.id);
       if (!groups[topic.primary_topic]) groups[topic.primary_topic] = [];
       groups[topic.primary_topic].push(article);
     }
     return groups;
   }
   ```

2. **Time-Based Grouping**:
   ```javascript
   // Group articles from same time period (e.g., weekly digest)
   function groupByTimeWindow(articles, windowDays = 7) {
     const groups = {};
     for (const article of articles) {
       const weekKey = getWeekKey(article.fetch_date);
       if (!groups[weekKey]) groups[weekKey] = [];
       groups[weekKey].push(article);
     }
     return groups;
   }
   ```

3. **Source-Based Grouping**:
   ```javascript
   // Group articles from same source/domain
   function groupBySource(articles) {
     const groups = {};
     for (const article of articles) {
       const domain = extractDomain(article.url);
       if (!groups[domain]) groups[domain] = [];
       groups[domain].push(article);
     }
     return groups;
   }
   ```

4. **Hybrid Grouping** (Recommended):
   ```javascript
   function hybridGrouping(articles) {
     // Step 1: Topic-based primary grouping
     const topicGroups = groupByTopic(articles);
     
     // Step 2: Within each topic, sub-group by similarity
     const finalGroups = [];
     for (const [topic, topicArticles] of Object.entries(topicGroups)) {
       if (topicArticles.length <= 3) {
         // Small group - keep as is
         finalGroups.push(topicArticles);
       } else {
         // Large group - sub-cluster by similarity
         const subClusters = clusterBySimilarity(topicArticles);
         finalGroups.push(...subClusters);
       }
     }
     
     return finalGroups;
   }
   ```

**Complexity**: ⭐⭐⭐⭐⭐ (Very Complex)

#### Phase 2.4: Synthesis Subject Generator

**Implementation**:
```javascript
// scripts/auto_planner/2_4_subject_generator.js
```

**For article groups**:
```javascript
async function generateSynthesisSubject(articleGroup) {
  // Extract common themes
  const keywords = extractCommonKeywords(articleGroup);
  
  // Generate subject using AI
  const prompt = `
    Given these ${articleGroup.length} articles about ${keywords.join(', ')},
    generate a compelling synthesis subject (max 100 chars):
    
    Articles:
    ${articleGroup.map(a => `- ${a.title}`).join('\n')}
  `;
  
  const subject = await callAI(prompt);
  return subject;
}
```

**Complexity**: ⭐⭐⭐ (Moderate - AI-assisted)

---

### Phase 3: Advanced Intelligence Features (FUTURE)

#### 3.1: Learning-Based Optimization

**Objective**: Learn from past successful plans

**Features**:
- Track which plan combinations generate best engagement
- Recommend optimal article groupings based on historical data
- Suggest best timing for content publication

#### 3.2: Trend Detection

**Objective**: Identify emerging topics and prioritize them

**Features**:
- Detect trending keywords across recent articles
- Flag "hot topics" for prioritized synthesis
- Suggest timely content combinations

#### 3.3: Gap Analysis

**Objective**: Identify content gaps in your portfolio

**Features**:
- Analyze which topics are under-represented
- Suggest article acquisition targets
- Recommend diversification strategies

---

## Recommended Implementation Path

### Immediate (Week 1-2):
✅ **Implement Phase 1**: Basic Individual Article Processing
- Very simple, high ROI
- Eliminates manual plan creation for simple cases
- Deliverable: Working `1_basic_planner.js`

### Short-term (Month 1-2):
⚠️ **Start Phase 2.1**: Similarity Analysis
- Moderate complexity
- Provides foundation for advanced features
- Deliverable: `similarity_matrix.csv`

### Medium-term (Month 2-4):
⚠️ **Implement Phase 2.3**: Smart Grouping (hybrid approach)
- Skip pure topic modeling initially (2.2) - too complex
- Focus on practical grouping strategies
- Deliverable: Working grouping engine

### Long-term (Month 4+):
⏸️ **Phase 2.2 & 2.4**: Advanced topic modeling and AI subject generation
⏸️ **Phase 3**: Learning and optimization features

---

## Configuration

Add to `config/profiles.json`:
```json
{
  "auto_planner": {
    "min_article_length": 500,
    "max_group_size": 5,
    "similarity_threshold": 0.7,
    "default_provider": "openai",
    "default_model": "gpt-4o-mini",
    "grouping_strategy": "hybrid",  // 'individual', 'topic', 'time', 'hybrid'
    "enable_ai_subjects": true
  }
}
```

## Required Dependencies

### Phase 1 (Basic):
```json
{
  "keyword-extractor": "^0.0.25",
  "natural": "^6.0.0"
}
```

### Phase 2 (Advanced):
```json
{
  "@tensorflow/tfjs-node": "^4.0.0",
  "ml-kmeans": "^6.0.0",
  "compromise": "^14.0.0",
  "stopword": "^2.0.0"
}
```

---

## Usage Examples

### Basic Mode (Phase 1):
```bash
# Generate simple plan (1 article per entry)
node scripts/auto_planner/1_basic_planner.js

# Output: data/3_plans/auto_generated_plan.csv
```

### Advanced Mode (Phase 2+):
```bash
# Analyze similarities
node scripts/auto_planner/2_1_similarity_analyzer.js

# Generate smart groupings
node scripts/auto_planner/2_3_smart_grouper.js --strategy hybrid

# Create synthesis plan
node scripts/auto_planner/auto_planner.js --mode synthesis

# Output: data/3_plans/auto_synthesis_plan.csv
```

---

## Success Metrics

- **Time Saved**: 80% reduction in manual planning time
- **Content Quality**: Improved relevance scores for synthesized content
- **Coverage**: 100% of processed articles utilized in plans
- **Diversity**: Balanced topic distribution in generated plans

---

## Recommendation

**START WITH PHASE 1 IMMEDIATELY** - it's simple, useful, and provides immediate value. The basic planner can be implemented in 1-2 hours and will handle 90% of common use cases.

**DEFER PHASE 2** until you have:
1. Clear evidence that simple individual article processing isn't sufficient
2. A dataset large enough (100+ articles) to make synthesis worthwhile
3. Specific synthesis use cases identified

The complexity jump from Phase 1 to Phase 2 is significant. Don't over-engineer before you have the need.
