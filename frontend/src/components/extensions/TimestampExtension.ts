import { Mark, mergeAttributes } from "@tiptap/core";

export interface TimestampOptions {
  HTMLAttributes: Record<string, any>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    timestamp: {
      setTimestamp: (time: number, label: string) => ReturnType;
    };
  }
}

export const TimestampExtension = Mark.create<TimestampOptions>({
  name: "timestamp",

  addOptions() {
    return {
      HTMLAttributes: {
        class: "timestamp-link cursor-pointer text-accent-primary hover:underline font-mono bg-accent-primary/10 px-1 py-0.5 rounded",
        style: "color: var(--accent-primary, #3b82f6); background-color: rgba(59, 130, 246, 0.1); padding: 2px 4px; border-radius: 4px; font-family: monospace; cursor: pointer;",
      },
    };
  },

  addAttributes() {
    return {
      time: {
        default: null,
        parseHTML: element => element.getAttribute("data-time"),
        renderHTML: attributes => {
          if (!attributes.time) return {};
          return { "data-time": attributes.time };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "a[data-time]",
      },
      {
        tag: "span[data-time]",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    // Render as a link pointing to #t=seconds
    const time = HTMLAttributes["data-time"] || "0";
    return ["a", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { href: `#t=${time}` }), 0];
  },

  addCommands() {
    return {
      setTimestamp:
        (time: number, label: string) =>
        ({ chain }) => {
          return chain()
            .insertContent({
              type: "text",
              text: label,
              marks: [
                {
                  type: this.name,
                  attrs: { time },
                },
              ],
            })
            .run();
        },
    };
  },
});
