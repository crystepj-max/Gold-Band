use crate::app::TaskSummary;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Screen {
    Welcome,
    TaskPicker,
    Workspace,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FocusPane {
    Welcome,
    TaskPicker,
    Dag,
    Detail,
    Input,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WelcomeAction {
    AddTask,
    SelectTask,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkspaceSelection {
    TaskOverview,
    Node { node_id: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DetailSelection {
    RetryAction,
    Attempt { attempt_id: String },
    Artifact { attempt_id: String, name: String },
    Attachment { attempt_id: String, name: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DetailLevel {
    NodeHome,
    AttemptItems { attempt_id: String },
    Content,
    CommandView,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CommandViewKind {
    Help,
    Log,
    Config,
    ContinueResult,
    RuntimeCommand,
}

#[derive(Debug, Clone)]
pub struct WorkspaceState {
    pub task_id: String,
    pub task_summary: TaskSummary,
    pub active_run_id: Option<String>,
    pub selected_round_id: Option<String>,
    pub selection: WorkspaceSelection,
    pub dag_positions: Vec<Vec<String>>,
    pub dag_column: usize,
    pub dag_row: usize,
    pub detail_level: DetailLevel,
    pub detail_items: Vec<DetailSelection>,
    pub detail_index: usize,
    pub detail_scroll: u16,
    pub command_view: Option<(CommandViewKind, String)>,
}

#[derive(Debug, Clone)]
pub struct ConsoleState {
    pub screen: Screen,
    pub focus: FocusPane,
    pub input: String,
    pub history: Vec<String>,
    pub message: Option<String>,
    pub auto_refresh_enabled: bool,
    pub last_refresh_label: Option<String>,
    pub welcome_action: WelcomeAction,
    pub task_list: Vec<TaskSummary>,
    pub task_index: usize,
    pub workspace: Option<WorkspaceState>,
    pub command_suggestions: Vec<String>,
}

impl Default for ConsoleState {
    fn default() -> Self {
        Self {
            screen: Screen::Welcome,
            focus: FocusPane::Welcome,
            input: String::new(),
            history: Vec::new(),
            message: None,
            auto_refresh_enabled: true,
            last_refresh_label: None,
            welcome_action: WelcomeAction::SelectTask,
            task_list: Vec::new(),
            task_index: 0,
            workspace: None,
            command_suggestions: Vec::new(),
        }
    }
}
