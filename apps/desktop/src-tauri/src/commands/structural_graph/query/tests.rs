use super::*;
use crate::commands::structural_graph::types::{
    GraphOrigin, StructuralGraphCommunity, StructuralGraphCoverage, StructuralGraphEngineInfo,
};

fn node(id: &str, label: &str, path: &str) -> StructuralGraphNode {
    StructuralGraphNode {
        id: id.to_string(),
        kind: "function".to_string(),
        label: label.to_string(),
        qualified_name: Some(format!("{path}::{label}")),
        path: Some(path.to_string()),
        detail: None,
        language: Some("rust".to_string()),
        community_id: None,
        trust: GraphTrust::Extracted,
        origin: GraphOrigin::Syntax,
        sources: Vec::new(),
    }
}

fn snapshot() -> StructuralGraphSnapshot {
    let nodes = vec![
        node("node:a", "start", "src/a.rs"),
        node("node:b", "middle", "src/b.rs"),
        node("node:c", "finish", "src/c.rs"),
        node("node:d", "start", "tests/a.rs"),
    ];
    let edge = |id: &str, from: &str, to: &str, trust| StructuralGraphEdge {
        id: id.to_string(),
        from: from.to_string(),
        to: to.to_string(),
        kind: "calls".to_string(),
        evidence: "test".to_string(),
        trust,
        origin: GraphOrigin::Syntax,
        sources: Vec::new(),
        candidates: Vec::new(),
    };
    StructuralGraphSnapshot {
        schema_version: 3,
        id: "snapshot".to_string(),
        repo_path: "/repo".to_string(),
        repo_head: Some("head".to_string()),
        created_at: "now".to_string(),
        engine: StructuralGraphEngineInfo {
            id: "engine".to_string(),
            version: "1".to_string(),
            bundled: true,
            syntax_aware: true,
            supported_languages: Vec::new(),
        },
        cursor: None,
        ignore_fingerprint: None,
        coverage: StructuralGraphCoverage::default(),
        diagnostics: Vec::new(),
        communities: Vec::new(),
        files: Vec::new(),
        nodes,
        edges: vec![
            edge("edge:ab", "node:a", "node:b", GraphTrust::Extracted),
            edge("edge:bc", "node:b", "node:c", GraphTrust::Extracted),
            edge("edge:ac", "node:a", "node:c", GraphTrust::Ambiguous),
        ],
        metrics: Vec::new(),
        clone_groups: Vec::new(),
        truncated: false,
    }
}

#[test]
fn search_prefers_exact_stable_identifier() {
    let result = search(
        &snapshot(),
        "node:a",
        &GraphQueryFilter::default(),
        Some(10),
    );
    assert_eq!(result.hits[0].node.id, "node:a");
    assert_eq!(result.hits[0].matched_by, "id");
}

#[test]
fn search_returns_hits_ordered_by_descending_relevance_score() {
    let result = search(
        &snapshot(),
        "start src/a.rs",
        &GraphQueryFilter::default(),
        Some(10),
    );
    assert!(result.hits.len() >= 2);
    assert!(
        result
            .hits
            .windows(2)
            .all(|pair| pair[0].score >= pair[1].score),
        "hits must be best-first with score decreasing: {:?}",
        result.hits.iter().map(|hit| hit.score).collect::<Vec<_>>()
    );
    // Scores separate near-matches instead of collapsing them onto one tier
    // value, which is what made large repositories rank almost arbitrarily.
    let distinct = result
        .hits
        .iter()
        .map(|hit| hit.score)
        .collect::<HashSet<_>>();
    assert!(distinct.len() > 1, "identical scores for unequal matches");
}

#[test]
fn search_retrieves_nodes_whose_only_match_is_inside_a_camel_case_or_path_token() {
    let mut graph = snapshot();
    // The query index is cached per snapshot id, so a mutated fixture needs its
    // own identity or it would be answered from another test's index.
    graph.id = "snapshot:camel".to_string();
    graph.nodes.push(StructuralGraphNode {
        id: "node:fullpath".to_string(),
        kind: "function".to_string(),
        label: "FullPath".to_string(),
        qualified_name: Some("src/context.go::FullPath".to_string()),
        path: Some("src/context.go".to_string()),
        detail: None,
        language: Some("go".to_string()),
        community_id: None,
        trust: GraphTrust::Extracted,
        origin: GraphOrigin::Syntax,
        sources: Vec::new(),
    });
    // "path" is only a suffix of the label and "context" only a stem of the file
    // name, so keying candidates on whole tokens never reached this node.
    for query in ["path", "context", "full path in context"] {
        let result = search(&graph, query, &GraphQueryFilter::default(), Some(10));
        assert!(
            result.hits.iter().any(|hit| hit.node.id == "node:fullpath"),
            "query {query:?} did not retrieve the camel-case/path match"
        );
    }
}

#[test]
fn adding_a_query_term_never_shrinks_the_retrieved_set() {
    let mut graph = snapshot();
    graph.id = "snapshot:monotonic".to_string();
    // "shared" is on most nodes, "paths" on exactly one: the shape that made a
    // frequency-based candidate ceiling drop the common term's nodes entirely.
    for index in 0..40 {
        graph.nodes.push(node(
            &format!("node:shared:{index}"),
            &format!("shared{index}"),
            &format!("src/shared{index}.rs"),
        ));
    }
    graph
        .nodes
        .push(node("node:paths", "paths", "src/paths.rs"));
    let ids = |query: &str| {
        search(&graph, query, &GraphQueryFilter::default(), Some(500))
            .hits
            .into_iter()
            .map(|hit| hit.node.id)
            .collect::<HashSet<_>>()
    };
    let shared = ids("shared");
    let both = ids("shared paths");
    assert!(
        shared.is_subset(&both),
        "adding a term dropped {} nodes",
        shared.difference(&both).count()
    );
}

#[test]
fn search_weights_rare_terms_above_terms_the_whole_graph_shares() {
    let mut graph = snapshot();
    graph.id = "snapshot:idf".to_string();
    for index in 0..40 {
        graph.nodes.push(node(
            &format!("node:common:{index}"),
            &format!("handler{index}"),
            &format!("src/handler{index}.rs"),
        ));
    }
    graph
        .nodes
        .push(node("node:rare", "reticulate", "src/rare.rs"));
    let result = search(
        &graph,
        "reticulate handler",
        &GraphQueryFilter::default(),
        Some(5),
    );
    assert_eq!(
        result.hits[0].node.id, "node:rare",
        "the rare term must outweigh the term forty nodes share"
    );
}

#[test]
fn search_seeds_natural_language_questions_without_stop_words() {
    let result = search(
        &snapshot(),
        "where is the finish function?",
        &GraphQueryFilter::default(),
        Some(10),
    );
    assert_eq!(result.hits[0].node.id, "node:c");
    assert_eq!(result.hits[0].matched_by, "lexical_question");
}

#[test]
fn search_pages_are_stable_and_carry_query_context() {
    let mut graph = snapshot();
    for index in 0..6 {
        graph.nodes.push(node(
            &format!("node:page:{index}"),
            &format!("paged target {index}"),
            &format!("src/page-{index}.rs"),
        ));
    }
    graph.coverage.discovered_files = 10;
    graph.coverage.indexed_files = 10;

    let first = search_page(
        &graph,
        "paged target",
        &GraphQueryFilter::default(),
        Some(2),
        None,
    )
    .expect("first page");
    let second = search_page(
        &graph,
        "paged target",
        &GraphQueryFilter::default(),
        Some(2),
        first.next_cursor.as_deref(),
    )
    .expect("second page");

    assert_eq!(first.hits.len(), 2);
    assert_eq!(second.hits.len(), 2);
    assert!(first.truncated);
    assert!(first.next_cursor.is_some());
    assert!(first
        .hits
        .iter()
        .all(|hit| second.hits.iter().all(|other| other.node.id != hit.node.id)));
    assert_eq!(first.context.snapshot_id, "snapshot");
    assert_eq!(first.context.coverage.indexed_files, 10);
    assert!(first.context.trust.extracted > 0);
    assert_eq!(first.context.freshness.stale, None);
}

#[test]
fn overview_is_bounded_and_prefers_connected_nodes() {
    let result = overview(&snapshot(), Some(2));
    assert_eq!(result.nodes.len(), 2);
    assert!(result.nodes.iter().any(|node| node.id == "node:a"));
    assert!(result.nodes.iter().any(|node| node.id == "node:b"));
    assert!(result.truncated);
    assert_eq!(result.next_cursor.as_deref(), Some("2"));
    assert_eq!(result.context.max_edges, MAX_EDGE_LIMIT);
}

#[test]
fn community_projection_is_bounded_and_rejects_unknown_ids() {
    let mut snapshot = snapshot();
    snapshot.communities = vec![StructuralGraphCommunity {
        id: "community:core".to_string(),
        label: "core".to_string(),
        member_count: 3,
        hub_node_ids: vec!["node:b".to_string()],
        bridge_node_ids: Vec::new(),
        score: 4.0,
    }];
    for node in snapshot.nodes.iter_mut().take(3) {
        node.community_id = Some("community:core".to_string());
    }
    let result = community(&snapshot, "community:core", Some(2)).unwrap();
    assert_eq!(result.nodes.len(), 2);
    assert!(result.truncated);
    assert!(community(&snapshot, "community:missing", Some(2)).is_err());
}

#[test]
fn filtered_multi_seed_subgraph_and_snapshot_diff_are_deterministic() {
    let snapshot = snapshot();
    let projection = subgraph(
        &snapshot,
        &["node:a".to_string(), "node:c".to_string()],
        Some(1),
        &GraphQueryFilter {
            trust: vec![GraphTrust::Extracted],
            ..GraphQueryFilter::default()
        },
        Some(10),
    )
    .unwrap();
    assert_eq!(
        projection
            .edges
            .iter()
            .map(|edge| edge.id.as_str())
            .collect::<Vec<_>>(),
        vec!["edge:ab", "edge:bc"]
    );

    let mut after = snapshot.clone();
    after.id = "snapshot:after".to_string();
    after.nodes[0].detail = Some("changed".to_string());
    after.nodes.pop();
    after.nodes.push(node("node:new", "new", "src/new.rs"));
    after.edges.pop();
    let diff = diff_snapshots(&snapshot, &after);
    assert_eq!(diff.added_node_ids, vec!["node:new"]);
    assert_eq!(diff.removed_node_ids, vec!["node:d"]);
    assert_eq!(diff.changed_node_ids, vec!["node:a"]);
    assert_eq!(diff.removed_edge_ids, vec!["edge:ac"]);
}

#[test]
fn ambiguous_labels_require_a_stable_identifier() {
    assert!(resolve_node(&snapshot(), "start")
        .unwrap_err()
        .contains("ambiguous"));
}

#[test]
fn path_prefers_extracted_edges_over_ambiguous_shortcuts() {
    let result = shortest_path(
        &snapshot(),
        "node:a",
        "node:c",
        &GraphQueryFilter::default(),
    )
    .unwrap();
    assert_eq!(result.edges.len(), 2);
    assert_eq!(result.edges[0].id, "edge:ab");
}

#[test]
fn impact_walks_reverse_callers_with_a_bound() {
    let result = impact(
        &snapshot(),
        "node:c",
        GraphDirection::Incoming,
        Some(3),
        &GraphQueryFilter::default(),
        Some(1),
    )
    .unwrap();
    assert_eq!(result.affected.len(), 1);
    assert!(result.truncated);

    let downstream = impact(
        &snapshot(),
        "node:a",
        GraphDirection::Outgoing,
        Some(1),
        &GraphQueryFilter::default(),
        Some(10),
    )
    .unwrap();
    assert!(downstream.affected.iter().any(|node| node.id == "node:b"));
}
