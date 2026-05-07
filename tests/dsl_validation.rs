use gold_band::dsl::{WorkflowDsl, validate_workflow};

fn parse_workflow(json: &str) -> WorkflowDsl {
    serde_json::from_str(json).expect("workflow should deserialize")
}

#[test]
fn validates_basic_workflow() {
    let workflow: WorkflowDsl = serde_json::from_str(
        r#"{
            "version": "0.1",
            "id": "dev-test-verify",
            "entry": "dev",
            "control": {
                "max_repair_loops": 3,
                "max_acceptance_loops": 2,
                "on_acceptance_failure": "auto-loop"
            },
            "nodes": [
                {
                    "id": "dev",
                    "type": "worker",
                    "provider": "claude-code",
                    "profile": "developer",
                    "goal": "implement requirement",
                    "primary_artifact": "exec-plan"
                },
                {
                    "id": "run-tests",
                    "type": "exec",
                    "plan_from": "dev"
                },
                {
                    "id": "accept",
                    "type": "verify"
                }
            ],
            "edges": [
                { "from": "dev", "to": "run-tests", "on": "success" },
                { "from": "run-tests", "to": "accept", "on": "success" },
                { "from": "run-tests", "to": "dev", "on": "failure", "session": "continue" }
            ]
        }"#,
    )
    .expect("workflow should deserialize");

    let validated = validate_workflow(workflow).expect("workflow should validate");
    assert_eq!(validated.raw.entry, "dev");
    assert_eq!(validated.verify_node_id.as_deref(), Some("accept"));
}

#[test]
fn rejects_exec_plan_from_non_worker() {
    let workflow = parse_workflow(
        r#"{
            "version": "0.1",
            "id": "invalid",
            "entry": "run-tests",
            "control": {
                "max_repair_loops": 1,
                "max_acceptance_loops": 1,
                "on_acceptance_failure": "stop"
            },
            "nodes": [
                { "id": "run-tests", "type": "exec", "plan_from": "accept" },
                { "id": "accept", "type": "verify" }
            ],
            "edges": []
        }"#,
    );

    assert!(validate_workflow(workflow).is_err());
}

#[test]
fn rejects_reserved_node_ids() {
    let workflow = parse_workflow(
        r#"{
            "version": "0.1",
            "id": "reserved-id",
            "entry": "worker",
            "control": {
                "max_repair_loops": 1,
                "max_acceptance_loops": 1,
                "on_acceptance_failure": "stop"
            },
            "nodes": [
                { "id": "worker", "type": "worker", "primary_artifact": "exec-plan" }
            ],
            "edges": []
        }"#,
    );

    assert!(validate_workflow(workflow).is_err());
}

#[test]
fn rejects_zero_loop_limits() {
    let workflow = parse_workflow(
        r#"{
            "version": "0.1",
            "id": "zero-loops",
            "entry": "dev",
            "control": {
                "max_repair_loops": 0,
                "max_acceptance_loops": 1,
                "on_acceptance_failure": "stop"
            },
            "nodes": [
                { "id": "dev", "type": "worker", "primary_artifact": "exec-plan" }
            ],
            "edges": []
        }"#,
    );

    assert!(validate_workflow(workflow).is_err());
}

#[test]
fn rejects_acceptance_policy_without_verify_node() {
    let workflow = parse_workflow(
        r#"{
            "version": "0.1",
            "id": "missing-verify",
            "entry": "dev",
            "control": {
                "max_repair_loops": 1,
                "max_acceptance_loops": 1,
                "on_acceptance_failure": "auto-loop"
            },
            "nodes": [
                { "id": "dev", "type": "worker", "primary_artifact": "exec-plan" }
            ],
            "edges": []
        }"#,
    );

    assert!(validate_workflow(workflow).is_err());
}

#[test]
fn rejects_invalid_edges_to_end() {
    let workflow = parse_workflow(
        r#"{
            "version": "0.1",
            "id": "invalid-end",
            "entry": "dev",
            "control": {
                "max_repair_loops": 1,
                "max_acceptance_loops": 1,
                "on_acceptance_failure": "stop"
            },
            "nodes": [
                { "id": "dev", "type": "worker", "primary_artifact": "exec-plan" },
                { "id": "run-tests", "type": "exec", "plan_from": "dev" },
                { "id": "accept", "type": "verify" }
            ],
            "edges": [
                { "from": "dev", "to": "run-tests", "on": "success" },
                { "from": "run-tests", "to": "$end", "on": "invalid" }
            ]
        }"#,
    );

    assert!(validate_workflow(workflow).is_err());
}

#[test]
fn rejects_continue_edges_to_unsupported_provider() {
    let workflow = parse_workflow(
        r#"{
            "version": "0.1",
            "id": "unsupported-provider",
            "entry": "dev",
            "control": {
                "max_repair_loops": 1,
                "max_acceptance_loops": 1,
                "on_acceptance_failure": "stop"
            },
            "nodes": [
                { "id": "dev", "type": "worker", "primary_artifact": "exec-plan" },
                { "id": "review", "type": "worker", "provider": "other-provider", "primary_artifact": "exec-plan" }
            ],
            "edges": [
                { "from": "dev", "to": "review", "on": "success", "session": "continue" }
            ]
        }"#,
    );

    assert!(validate_workflow(workflow).is_err());
}
