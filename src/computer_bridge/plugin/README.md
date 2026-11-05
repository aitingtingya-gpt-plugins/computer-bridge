# Computer Bridge

Use original files and local commands on an explicitly selected registered computer.
Connect the plugin to your service's `/mcp` endpoint using OAuth. The base package provides the computer-bridge Skill; optional modules provide their own instructions and capabilities after activation.

Select a computer, open an authorized directory, and retain the returned session and context handles. Short command output is returned directly; use the provided stdout_read/stderr_read parameters for complete output. Recover interrupted requests by their original request ID instead of repeating side effects with a new key.

For terminal or web chat, resume a short conversation ID such as t1 with chat.resume and subscribe to chat.message using MCP Events in Work or Dot. Read chat.history and send answers with chat.reply. A conversation already in use cannot be taken over; ordinary Chat does not support event wake.
