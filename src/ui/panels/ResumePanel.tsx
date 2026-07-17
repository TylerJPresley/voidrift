import React from "react";
import { DeclarativePanel } from "../DeclarativePanel.js";
import type { PanelSchema } from "../panel-schema.js";
import type { CoreAPI } from "../../plugins/interface.js";

export function ResumePanel({ core, onResume, onClose }: { core: CoreAPI; onResume: (id: string, messages: Array<{ role: string; content: string }>) => void; onClose: () => void }) {
  const currentSessionId = core.session.id;

  const relativeTime = (ts: number) => {
    const diff = Date.now() - ts;
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
  };

  const loadSessions = () => {
    const sessions = core.session.list();
    return sessions.map(s => {
      const msgs = core.session.loadMessages(s.id);
      const lastUser = [...msgs].reverse().find((m: any) => m.role === "user");
      const lastMessage = lastUser ? lastUser.content.slice(0, 60).replace(/\n/g, " ") : "";
      return { ...s, lastMessage };
    });
  };

  const schema: PanelSchema = {
    id: "resume",
    title: "Conversations",
    layout: {
      type: "list",
      columns: [
        { key: "session", label: "Session", width: 12 },
        { key: "turns", label: "Turns", width: 8 },
        { key: "activity", label: "Activity", width: 12 },
        { key: "message", label: "Last Message" },
      ],
      getItems: () => loadSessions().map(s => ({
        session: (s.id === currentSessionId ? "● " : "  ") + s.id.slice(0, 8),
        turns: String(s.turnCount),
        activity: relativeTime(s.lastActivity),
        message: s.lastMessage,
        _id: s.id,
      })),
      cursor: true,
    },
    actions: [
      { key: "enter", label: "Resume", handler: (item) => {
        if (!item) return;
        const msgs = core.session.loadMessages(item._id);
        onResume(item._id, msgs);
      }},
    ],
  };

  return <DeclarativePanel schema={schema} onClose={onClose} />;
}
