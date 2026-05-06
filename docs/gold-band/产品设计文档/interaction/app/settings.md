# 桌面客户端设置页

## 1. 一句话定义
设置页用于管理桌面客户端本地偏好；当前 MVP 只包含主题切换和语言选择。

---

## 2. 页面入口
进入方式：
- 点击左侧底部 Settings / 设置
- 使用系统菜单中的 Settings
- 可选：快捷键打开设置

---

## 3. 页面结构

```text
┌──────────────────────────────────────────────────────────────┐
│ 面包屑：设置                                                   │
│ 标题：设置                                                     │
├──────────────────────────────────────────────────────────────┤
│ 外观                                                         │
│   主题：Light / Dark / System                                 │
│                                                              │
│ 语言                                                         │
│   语言选择：中文 / English                                    │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. 主题切换

### 4.1 选项
当前支持：
- Light
- Dark
- System

### 4.2 行为
- 选择后立即预览。
- 设置保存到本地用户偏好。
- System 跟随操作系统主题。

### 4.3 UI 形式
推荐使用 segmented control：

```text
主题    [ Light | Dark | System ]
```

---

## 5. 语言选择

### 5.1 选项
当前支持：
- 中文
- English

### 5.2 行为
- 选择后立即切换界面语言，或提示重启后生效。
- 语言设置保存到本地用户偏好。

### 5.3 UI 形式
推荐使用下拉选择：

```text
语言    中文 v
```

---

## 6. 设置范围
当前设置是桌面客户端本地偏好，不属于 task / run / round 的 canonical state。

后续如果加入 provider、workspace、workflow preset 等设置，应区分：
- 用户级设置
- workspace 级设置
- task 级设置
- provider 级设置

---

## 7. Tauri 2.x MVP 对应实现

MVP 中设置页由 `web/src/pages/SettingsPage.tsx` 实现，通过 Tauri command `save_desktop_preferences` 保存用户偏好。

当前实现规则：
- 主题字段保存为 `desktopTheme`，支持 `light`、`dark`、`system`。
- 语言字段保存为 `desktopLanguage`，支持 `zh-cn`、`en`。
- 主题使用 segmented control，语言使用下拉选择，选择后立即调用 `save_desktop_preferences` 保存并预览。
- 首次启动默认主题为 `dark`，以匹配当前 desktop dark 原型；用户显式选择 `system` 后再跟随操作系统主题。
- 设置属于用户级桌面偏好，不写入 task / run / round canonical state。
- 2026-05-03 起设置页使用 Tailwind CSS v4 + shadcn/ui Card、Button、Select、Badge 等现成组件重构；主题和语言选择后立即保存并预览的行为不变。

---

## 8. 一句话总结

> 当前设置页只解决“我想用什么主题和语言”，不承载任务编排、provider 配置或 workflow 编辑能力。
