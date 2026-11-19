# Chat Log Render

Render chat logs into chat-bubble cards inside your Obsidian notes. Paste a raw chat export (WeChat, QQ, or any `name + time + message` text) into a ` ```chat ` code block and it becomes a clean chat UI in reading view.

## Features

- **Paste and go** — no rigid schema. Paste chat text straight from WeChat mobile multi-select, PC exports, or handwritten notes.
- **Three header formats** auto-detected:
  - Name line followed by a time line (WeChat mobile export)
    ```
    Alice
    2026/11/19 9:31
    Good morning!
    ```
  - Name and datetime on one line (PC export)
    ```
    Alice 2026/11/19 9:31:02
    Good morning!
    ```
  - Bracket style
    ```
    [2026/11/19 9:31:02] Alice: Good morning!
    ```
- **Smart parsing** — data timestamps inside message bodies (e.g. `2026-10-17 13:34:02` pasted as part of a debug log) are kept as body text, not misread as new messages.
- **Media lines** — `[image]`, `[file]`, `[voice]`, `[video]` and similar lines render as media cards with icons.
- **System lines** — a line starting with `>` renders as a centered grey system notice (e.g. "Merged forwarded messages").
- **Date dividers** — inserted automatically when the date changes.
- **Avatars** — deterministic colors from the sender name hash; first character as the avatar letter.
- **Title** — a `# heading` on the first line becomes the chat window title (group name).

## Usage

````markdown
```chat
# Project Team

Alice
2026/11/19 9:31
Which API was it?

Bob
2026/11/19 9:46
Project ID: bf5ad9cf
API: POST /project/update
- When was it changed
2026-10-17 13:34:02
```
````

Accepted code block languages: `chat`, `chatlog`, `wechat`, `微信`.

## Settings

| Setting | Description |
|---------|-------------|
| Right-side name | Your own nickname in the chat. Messages from this sender render as green bubbles on the right (like WeChat). Empty = all left. |
| Show avatars | Toggle avatar blocks on/off. |

## Manual install

1. Download `main.js`, `manifest.json`, `styles.css` from the latest release.
2. Put them in `<vault>/.obsidian/plugins/chat-log-render/`.
3. Enable "Chat Log Render" in Settings → Community plugins.

## Compatibility

- Requires Obsidian 1.0.0 or later.
- Works on desktop and mobile (pure JS, no build step).

## License

[MIT](LICENSE)
