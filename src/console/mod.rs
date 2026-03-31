pub mod commands;
pub mod controller;
#[allow(dead_code)]
mod events;
pub mod state;
pub mod view_models;

use std::io::{self, Stdout};
use std::time::Duration;

use anyhow::Result;
use crossterm::event::{self, Event, KeyCode, KeyEventKind};
use crossterm::execute;
use crossterm::terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen};
use ratatui::backend::CrosstermBackend;
use ratatui::layout::{Constraint, Direction, Layout};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::Span;
use ratatui::widgets::{Block, Borders, Paragraph, Wrap};
use ratatui::Terminal;

use crate::app::App;

use self::controller::{activate_current, cycle_focus, escape, move_down, move_left, move_right, move_up, refresh_command_suggestions, refresh_tick};
use self::state::{ConsoleState, FocusPane, Screen};
use self::view_models::build_view_model;

pub fn run_console(app: &App) -> Result<()> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;
    let result = run_console_loop(app, &mut terminal);
    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;
    result
}

fn run_console_loop(app: &App, terminal: &mut Terminal<CrosstermBackend<Stdout>>) -> Result<()> {
    let mut state = ConsoleState::default();

    loop {
        let vm = build_view_model(app, &state)?;
        terminal.draw(|frame| {
            let areas = if vm.show_detail {
                Layout::default()
                    .direction(Direction::Vertical)
                    .constraints([
                        Constraint::Length(4),
                        Constraint::Min(8),
                        Constraint::Length(10),
                        Constraint::Length(3),
                        Constraint::Length(1),
                    ])
                    .split(frame.area())
            } else {
                Layout::default()
                    .direction(Direction::Vertical)
                    .constraints([
                        Constraint::Length(4),
                        Constraint::Min(18),
                        Constraint::Length(3),
                        Constraint::Length(1),
                    ])
                    .split(frame.area())
            };

            frame.render_widget(
                Paragraph::new(vm.header)
                    .wrap(Wrap { trim: false })
                    .block(panel_block("Gold Band / Runtime Console", false))
                    .style(Style::default().fg(Color::Rgb(245, 245, 245)).bg(Color::Rgb(20, 20, 20))),
                areas[0],
            );
            frame.render_widget(
                Paragraph::new(vm.body_lines.join("\n"))
                    .wrap(Wrap { trim: false })
                    .block(panel_block(&vm.body_title, state.focus == FocusPane::Welcome || state.focus == FocusPane::TaskPicker || state.focus == FocusPane::Dag))
                    .style(Style::default().fg(Color::Rgb(220, 220, 220)).bg(Color::Rgb(16, 16, 16))),
                areas[1],
            );
            if vm.show_detail {
                frame.render_widget(
                    Paragraph::new(vm.detail_body)
                        .wrap(Wrap { trim: false })
                        .block(panel_block(&vm.detail_title, state.focus == FocusPane::Detail))
                        .style(Style::default().fg(Color::Rgb(245, 245, 245)).bg(Color::Rgb(12, 12, 12))),
                    areas[2],
                );
            }
            let input_area = if vm.show_detail { areas[3] } else { areas[2] };
            let footer_area = if vm.show_detail { areas[4] } else { areas[3] };
            frame.render_widget(
                Paragraph::new(if vm.input.is_empty() { vm.input_hint.clone() } else { vm.input.clone() })
                    .block(panel_block(&vm.input_title, state.focus == FocusPane::Input))
                    .style(if vm.input.is_empty() {
                        Style::default().fg(Color::Rgb(120, 120, 120)).bg(Color::Rgb(18, 18, 18))
                    } else {
                        Style::default().fg(Color::White).bg(Color::Rgb(18, 18, 18))
                    }),
                input_area,
            );
            frame.render_widget(
                Paragraph::new(vm.footer)
                    .style(Style::default().fg(Color::Rgb(170, 170, 170)).bg(Color::Rgb(25, 25, 25)).add_modifier(Modifier::DIM)),
                footer_area,
            );
        })?;

        if event::poll(Duration::from_millis(250))? {
            if let Event::Key(key) = event::read()? {
                if key.kind != KeyEventKind::Press {
                    continue;
                }
                match key.code {
                    KeyCode::Esc => {
                        if escape(app, &mut state)? {
                            break;
                        }
                    }
                    KeyCode::Tab => cycle_focus(&mut state),
                    KeyCode::Up if state.focus != FocusPane::Input => move_up(&mut state),
                    KeyCode::Down if state.focus != FocusPane::Input => move_down(&mut state),
                    KeyCode::Left => move_left(&mut state),
                    KeyCode::Right => move_right(&mut state),
                    KeyCode::Enter => activate_current(app, &mut state)?,
                    KeyCode::Backspace if state.focus == FocusPane::Input => {
                        state.input.pop();
                        refresh_command_suggestions(&mut state);
                    }
                    KeyCode::Char(c) if state.focus == FocusPane::Input => {
                        state.input.push(c);
                        refresh_command_suggestions(&mut state);
                    }
                    _ => {}
                }
            }
        } else {
            refresh_tick(app, &mut state)?;
        }

        if state.screen == Screen::Welcome && state.focus == FocusPane::Input && state.input.is_empty() {
            state.focus = FocusPane::Welcome;
        }
    }

    Ok(())
}

fn panel_block(title: &str, focused: bool) -> Block<'static> {
    let title = title.to_string();
    let style = if focused {
        Style::default().fg(Color::Rgb(240, 200, 120)).add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(Color::Rgb(90, 90, 90))
    };
    Block::default().borders(Borders::ALL).border_style(style).title(Span::styled(title, style))
}
