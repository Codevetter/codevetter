use super::*;

/// Highest score any hit can carry. Scores are `u32` on a fixed scale so paging
/// and cursors stay byte-stable across processes, and **higher means more
/// relevant** — the ordinary convention for a field called `score`.
pub(super) const MAX_SCORE: u32 = 999_999;
/// Tier floors. A tier is chosen by *how* the node matched; the lexical
/// relevance of the same node is then added on top, so nodes inside one tier are
/// still ordered against each other instead of tying at a single value.
const TIER_ID: u32 = 900_000;
const TIER_QUALIFIED: u32 = 800_000;
const TIER_PATH: u32 = 700_000;
const TIER_LABEL: u32 = 600_000;
const TIER_QUALIFIED_CONTAINS: u32 = 500_000;
const TIER_PATH_CONTAINS: u32 = 400_000;
const TIER_LABEL_CONTAINS: u32 = 300_000;
const TIER_LEXICAL: u32 = 0;
const TIER_SPAN: f64 = 99_999.0;

/// Field weights for lexical matching. A term found in a node's own name says
/// far more about the node than the same term found in its surrounding detail
/// text, and the old flat "matched or not" score could not express that.
const WEIGHT_LABEL: f64 = 1.0;
const WEIGHT_QUALIFIED: f64 = 0.75;
const WEIGHT_PATH: f64 = 0.6;
const WEIGHT_KIND: f64 = 0.25;
const WEIGHT_DETAIL: f64 = 0.4;

pub(super) fn normalize(value: &str) -> String {
    value.trim().replace('\\', "/").to_lowercase()
}

pub(super) fn node_matches_filter(node: &StructuralGraphNode, filter: &GraphQueryFilter) -> bool {
    (filter.node_kinds.is_empty() || filter.node_kinds.iter().any(|kind| kind == &node.kind))
        && (filter.trust.is_empty() || filter.trust.contains(&node.trust))
}

pub(super) fn edge_matches_filter(edge: &StructuralGraphEdge, filter: &GraphQueryFilter) -> bool {
    (filter.edge_kinds.is_empty() || filter.edge_kinds.iter().any(|kind| kind == &edge.kind))
        && (filter.trust.is_empty() || filter.trust.contains(&edge.trust))
}

/// Which whole-value comparison, if any, the node satisfied against the raw
/// query string. Returns the tier floor plus the `matched_by` label.
pub(super) fn rank_node(node: &StructuralGraphNode, needle: &str) -> Option<(u32, String)> {
    let id = normalize(&node.id);
    let qualified = node.qualified_name.as_deref().map(normalize);
    let path = node.path.as_deref().map(normalize);
    let label = normalize(&node.label);
    if id == needle {
        Some((TIER_ID, "id".to_string()))
    } else if qualified.as_deref() == Some(needle) {
        Some((TIER_QUALIFIED, "qualified_name".to_string()))
    } else if path.as_deref() == Some(needle) {
        Some((TIER_PATH, "path".to_string()))
    } else if label == needle {
        Some((TIER_LABEL, "label".to_string()))
    } else if qualified
        .as_deref()
        .is_some_and(|value| value.contains(needle))
    {
        Some((
            TIER_QUALIFIED_CONTAINS,
            "qualified_name_contains".to_string(),
        ))
    } else if path.as_deref().is_some_and(|value| value.contains(needle)) {
        Some((TIER_PATH_CONTAINS, "path_contains".to_string()))
    } else if label.contains(needle) {
        Some((TIER_LABEL_CONTAINS, "label_contains".to_string()))
    } else {
        None
    }
}

const STOP_WORDS: &[&str] = &[
    "a", "an", "and", "are", "does", "for", "from", "how", "in", "is", "of", "on", "or", "the",
    "to", "what", "when", "where", "which", "why", "with",
];

fn is_token_char(character: char) -> bool {
    character.is_alphanumeric() || matches!(character, '_' | '-' | '.' | '/' | ':' | '\\')
}

/// Splits one raw token into every key a query might plausibly arrive as.
///
/// The whole token is kept, plus each path/qualifier segment, plus each
/// camelCase, snake_case and letter/digit word inside those segments. Case is
/// read from the *raw* token, so this has to run before lowercasing: once
/// `FullPath` becomes `fullpath` the word boundary is gone. Candidate generation
/// used to key on whole tokens only while the ranker scored by substring, so a
/// node whose only match was inside a token — `path` inside `FullPath`, or
/// `context` inside `context.go` — could be scored but never retrieved. That
/// mismatch, not the requested limit, was what capped recall.
fn token_keys(raw: &str) -> Vec<String> {
    let mut keys = Vec::new();
    let mut push = |value: String| {
        if value.len() >= 2 && !STOP_WORDS.contains(&value.as_str()) && !keys.contains(&value) {
            keys.push(value);
        }
    };
    let whole = raw.to_lowercase();
    push(whole.clone());
    let segments = raw
        .split(['_', '-', '.', '/', ':', '\\'])
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();
    for segment in &segments {
        if segments.len() > 1 {
            push(segment.to_lowercase());
        }
        for word in case_words(segment) {
            push(word);
        }
    }
    keys
}

/// `parseURLQuery` -> `parse`, `url`, `query`; `sha256Sum` -> `sha`, `256`, `sum`.
fn case_words(segment: &str) -> Vec<String> {
    let characters = segment.chars().collect::<Vec<_>>();
    let mut words = Vec::new();
    let mut current = String::new();
    for (position, character) in characters.iter().copied().enumerate() {
        let previous = position.checked_sub(1).map(|index| characters[index]);
        let next = characters.get(position + 1).copied();
        let boundary = match previous {
            None => false,
            Some(previous) => {
                (character.is_uppercase() && previous.is_lowercase())
                    || (character.is_numeric() != previous.is_numeric())
                    || (character.is_uppercase()
                        && previous.is_uppercase()
                        && next.is_some_and(char::is_lowercase))
            }
        };
        if boundary && !current.is_empty() {
            words.push(std::mem::take(&mut current));
        }
        current.push(character);
    }
    if !current.is_empty() {
        words.push(current);
    }
    if words.len() < 2 {
        return Vec::new();
    }
    words
        .into_iter()
        .map(|word| word.to_lowercase())
        .filter(|word| word.len() >= 2)
        .collect()
}

fn index_keys(text: &str) -> Vec<String> {
    let mut keys = Vec::new();
    for raw in text.split(|character: char| !is_token_char(character)) {
        let raw = raw.trim();
        if raw.is_empty() {
            continue;
        }
        for key in token_keys(raw) {
            keys.push(key);
        }
    }
    keys.sort();
    keys.dedup();
    keys
}

/// One search term plus the weight it carries. Terms nothing in the graph
/// contains are dropped: a pull-request number or a verb like `add` that no node
/// mentions would otherwise sit in the denominator and flatten the difference
/// between the terms that do discriminate.
#[derive(Debug)]
pub(super) struct LexicalTerm {
    text: String,
    weight: f64,
}

#[derive(Debug, Default)]
pub(super) struct LexicalQuery {
    terms: Vec<LexicalTerm>,
    total_weight: f64,
}

impl LexicalQuery {
    pub(super) fn is_empty(&self) -> bool {
        self.terms.is_empty()
    }
}

/// Expands the raw query into weighted terms using the snapshot's own term
/// frequencies, so a term that half the graph mentions cannot outvote one only a
/// handful of nodes mention.
pub(super) fn lexical_query(query: &str, index: &StructuralGraphQueryIndex) -> LexicalQuery {
    let node_count = index.node_count.max(1) as f64;
    let mut terms = Vec::<LexicalTerm>::new();
    for raw in query.split(|character: char| !is_token_char(character)) {
        let raw = raw.trim();
        if raw.is_empty() {
            continue;
        }
        for text in token_keys(raw) {
            if terms.iter().any(|term| term.text == text) {
                continue;
            }
            let frequency = index.tokens.get(&text).map_or(0, Vec::len);
            if frequency == 0 {
                continue;
            }
            let weight = (1.0 + node_count / (1.0 + frequency as f64)).ln();
            terms.push(LexicalTerm { text, weight });
        }
    }
    terms.sort_by(|left, right| {
        right
            .weight
            .total_cmp(&left.weight)
            .then_with(|| left.text.cmp(&right.text))
    });
    let total_weight = terms.iter().map(|term| term.weight).sum();
    LexicalQuery {
        terms,
        total_weight,
    }
}

/// How well `field` satisfies `term`: whole value, whole word, word prefix, or
/// bare substring. Distinguishing these is what lets many weakly-matching nodes
/// be ordered instead of tying.
fn field_hit(field: &str, term: &str) -> f64 {
    if field.is_empty() {
        return 0.0;
    }
    if field == term {
        return 1.0;
    }
    let mut best = 0.0f64;
    let bytes = field.as_bytes();
    let mut from = 0usize;
    while let Some(offset) = field[from..].find(term) {
        let start = from + offset;
        let end = start + term.len();
        let boundary_before = start == 0 || !bytes[start - 1].is_ascii_alphanumeric();
        let boundary_after = end == field.len() || !bytes[end].is_ascii_alphanumeric();
        let quality = match (boundary_before, boundary_after) {
            (true, true) => 0.9,
            (true, false) => 0.65,
            _ => 0.4,
        };
        best = best.max(quality);
        if best >= 0.9 {
            break;
        }
        from = start + term.len().max(1);
        if from >= field.len() {
            break;
        }
    }
    best
}

/// Lexical relevance in `[0, 1]`: the weighted share of query terms this node
/// satisfies, each term scored in the best-weighted field that contains it.
pub(super) fn lexical_relevance(node: &StructuralGraphNode, query: &LexicalQuery) -> f64 {
    if query.total_weight <= 0.0 {
        return 0.0;
    }
    let label = normalize(&node.label);
    let qualified = node.qualified_name.as_deref().map(normalize);
    let path = node.path.as_deref().map(normalize);
    let kind = normalize(&node.kind);
    let detail = node.detail.as_deref().map(normalize);
    let mut earned = 0.0f64;
    for term in &query.terms {
        let mut best = WEIGHT_LABEL * field_hit(&label, &term.text);
        for (weight, field) in [
            (WEIGHT_QUALIFIED, qualified.as_deref()),
            (WEIGHT_PATH, path.as_deref()),
            (WEIGHT_DETAIL, detail.as_deref()),
        ] {
            if let Some(field) = field {
                best = best.max(weight * field_hit(field, &term.text));
            }
        }
        best = best.max(WEIGHT_KIND * field_hit(&kind, &term.text));
        earned += term.weight * best;
    }
    (earned / query.total_weight).clamp(0.0, 1.0)
}

/// Folds a tier floor and a lexical relevance into the single `u32` a hit
/// reports. Higher is more relevant.
pub(super) fn tiered_score(tier: u32, relevance: f64) -> u32 {
    tier.saturating_add((relevance.clamp(0.0, 1.0) * TIER_SPAN).round() as u32)
        .min(MAX_SCORE)
}

/// Score for a node that matched nothing as a whole value but does match query
/// terms. `None` when no term is present at all, so non-matching nodes stay out
/// of the result rather than arriving with a zero score.
pub(super) fn rank_question_tokens(
    node: &StructuralGraphNode,
    query: &LexicalQuery,
) -> Option<(u32, String)> {
    if query.is_empty() {
        return None;
    }
    let relevance = lexical_relevance(node, query);
    (relevance > 0.0).then(|| {
        (
            tiered_score(TIER_LEXICAL, relevance),
            "lexical_question".to_string(),
        )
    })
}

pub(super) fn node_map(snapshot: &StructuralGraphSnapshot) -> HashMap<&str, &StructuralGraphNode> {
    snapshot
        .nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect()
}

pub(super) fn query_index(snapshot: &StructuralGraphSnapshot) -> Arc<StructuralGraphQueryIndex> {
    let indexes = QUERY_INDEXES.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(cache) = indexes.lock() {
        if let Some(index) = cache.get(&snapshot.id) {
            return Arc::clone(index);
        }
    }
    let mut index = StructuralGraphQueryIndex {
        node_count: snapshot.nodes.len(),
        ..StructuralGraphQueryIndex::default()
    };
    for (ordinal, node) in snapshot.nodes.iter().enumerate() {
        for value in [
            Some(node.id.as_str()),
            node.path.as_deref(),
            node.qualified_name.as_deref(),
            Some(node.label.as_str()),
        ]
        .into_iter()
        .flatten()
        {
            index
                .exact
                .entry(normalize(value))
                .or_default()
                .push(ordinal);
        }
        let searchable = format!(
            "{} {} {} {} {}",
            node.label,
            node.qualified_name.as_deref().unwrap_or_default(),
            node.path.as_deref().unwrap_or_default(),
            node.kind,
            node.detail.as_deref().unwrap_or_default()
        );
        for token in index_keys(&searchable) {
            index.tokens.entry(token).or_default().push(ordinal);
        }
    }
    for postings in index.tokens.values_mut() {
        postings.sort_unstable();
        postings.dedup();
    }
    let index = Arc::new(index);
    if let Ok(mut cache) = indexes.lock() {
        if cache.len() >= MAX_QUERY_INDEXES {
            cache.clear();
        }
        cache.insert(snapshot.id.clone(), Arc::clone(&index));
    }
    index
}

/// Candidate ordinals for a query: every node carrying any query term, plus any
/// whole-value match on the raw needle.
///
/// Deliberately unfiltered. An earlier version of this skipped terms whose
/// posting list covered more than a quarter of the graph, to avoid scoring
/// everything for a query that merely mentioned `.go`. That was wrong in a way
/// worth recording: seeding is a union, so skipping a term is only harmless when
/// no other term seeds anything. On a repository where `reel` appeared in a
/// quarter of all nodes, the query `reel paths` seeded from `paths` alone and
/// retrieved 6 nodes where `reel` on its own retrieved over 500 — adding a term
/// shrank the result. Any ceiling here recreates the exact defect this module
/// exists to avoid: a retriever narrower than the ranker. Discrimination belongs
/// in the score, where a term the whole graph shares already earns almost no
/// weight.
pub(super) fn candidate_ordinals(
    index: &StructuralGraphQueryIndex,
    needle: &str,
    query: &LexicalQuery,
) -> Vec<usize> {
    let mut candidates = HashSet::new();
    if let Some(exact) = index.exact.get(needle) {
        candidates.extend(exact.iter().copied());
    }
    for term in &query.terms {
        if let Some(postings) = index.tokens.get(&term.text) {
            candidates.extend(postings.iter().copied());
        }
    }
    let mut candidates = candidates.into_iter().collect::<Vec<_>>();
    candidates.sort_unstable();
    candidates
}

pub(super) fn trust_cost(trust: GraphTrust) -> f64 {
    match trust {
        GraphTrust::Extracted => 1.0,
        GraphTrust::Inferred => 1.6,
        GraphTrust::Ambiguous => 3.5,
        GraphTrust::Legacy => 4.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_keys_expand_paths_and_camel_case_without_losing_the_whole_token() {
        assert_eq!(
            token_keys("context.go"),
            vec!["context.go", "context", "go"]
        );
        assert_eq!(token_keys("FullPath"), vec!["fullpath", "full", "path"]);
        assert_eq!(
            token_keys("src/parseURLQuery"),
            vec![
                "src/parseurlquery",
                "src",
                "parseurlquery",
                "parse",
                "url",
                "query"
            ]
        );
        // A single lowercase word expands to itself and nothing else.
        assert_eq!(token_keys("copy"), vec!["copy"]);
    }

    #[test]
    fn field_hit_separates_whole_word_prefix_and_substring_matches() {
        assert_eq!(field_hit("path", "path"), 1.0);
        assert_eq!(field_hit("full path here", "path"), 0.9);
        assert_eq!(field_hit("pathfinder", "path"), 0.65);
        assert_eq!(field_hit("fullpath", "path"), 0.4);
        assert_eq!(field_hit("unrelated", "path"), 0.0);
    }
}
