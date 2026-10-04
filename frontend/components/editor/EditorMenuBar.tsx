"use client";

import { useEffect, useRef, useState } from "react";
import {
  FilePlus,
  FolderPlus,
  Upload,
  Download,
  History,
  Hash,
  Undo2,
  Redo2,
  Search,
  ClipboardList,
  Table2,
  Link,
  MessageSquare,
  Bold,
  Italic,
  List,
  ListOrdered,
  IndentIncrease,
  IndentDecrease,
  LayoutTemplate,
  SplitSquareHorizontal,
  PanelLeft,
  Maximize2,
  Keyboard,
  HelpCircle,
  Mail,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MenuAction {
  label: string;
  shortcut?: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** Renders a horizontal divider before this item */
  divider?: boolean;
  /** Sub-items (one level only) */
  children?: Omit<MenuAction, "children">[];
}

interface MenuDef {
  label: string;
  items: MenuAction[];
}

interface EditorMenuBarProps {
  projectName: string;
  canEdit: boolean;
  canUndo: boolean;
  canRedo: boolean;
  isLayoutSplit: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onFind: () => void;
  onSave: () => void;
  onCompile: () => void;
  onCreateFile: () => void;
  onToggleLayout: () => void;
  onDownloadZip: () => void;
  onShowHistory: () => void;
  onInsert: (latex: string) => void;
}

// ─── Single menu popup ────────────────────────────────────────────────────────

function MenuPopup({
  items,
  onClose,
  anchorRef,
  onPopupMouseEnter,
  onPopupMouseLeave,
}: {
  items: MenuAction[];
  onClose: () => void;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onPopupMouseEnter: () => void;
  onPopupMouseLeave: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [subMenu, setSubMenu] = useState<number | null>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    const btn = anchorRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    setPos({ top: rect.bottom, left: rect.left });
  }, [anchorRef]);

  // Close on click outside or Escape
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const btn = anchorRef.current;
      if (
        !ref.current?.contains(e.target as Node) &&
        !btn?.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose, anchorRef]);

  return (
    <div
      ref={ref}
      style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 9999 }}
      className="w-52 bg-white border border-gray-200 rounded-md shadow-lg py-1 text-sm text-gray-700"
      onMouseEnter={onPopupMouseEnter}
      onMouseLeave={onPopupMouseLeave}
    >
      {items.map((item, i) => {
        if (item.divider) {
          return (
            <div key={`div-${i}`}>
              <div className="border-t border-gray-100 my-1" />
              {renderItem(item, i)}
            </div>
          );
        }
        return renderItem(item, i);
      })}
    </div>
  );

  function renderItem(item: MenuAction, i: number) {
    const hasChildren = item.children && item.children.length > 0;

    return (
      <div key={i} className="relative" onMouseEnter={() => setSubMenu(hasChildren ? i : null)}>
        <button
          type="button"
          disabled={item.disabled}
          onClick={() => {
            if (!item.disabled && !hasChildren) {
              item.onClick?.();
              onClose();
            }
          }}
          className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left transition-colors ${
            item.disabled
              ? "opacity-40 cursor-not-allowed text-gray-400"
              : item.danger
                ? "hover:bg-red-50 text-red-600"
                : "hover:bg-gray-100 text-gray-700"
          }`}
        >
          <span className="flex items-center gap-2.5 min-w-0">
            {item.icon && (
              <span className="w-4 h-4 shrink-0 text-gray-400">{item.icon}</span>
            )}
            <span className="truncate">{item.label}</span>
          </span>
          <span className="flex items-center gap-1 shrink-0">
            {item.shortcut && (
              <span className="text-[10px] text-gray-400 font-mono">{item.shortcut}</span>
            )}
            {hasChildren && <span className="text-gray-400 text-xs">›</span>}
          </span>
        </button>

        {/* Sub-menu */}
        {hasChildren && subMenu === i && (
          <div
            style={{ position: "absolute", top: 0, left: "100%" }}
            className="w-44 bg-white border border-gray-200 rounded-md shadow-lg py-1 text-sm text-gray-700 ml-0.5"
          >
            {item.children!.map((child, j) => (
              <button
                key={j}
                type="button"
                disabled={child.disabled}
                onClick={() => {
                  if (!child.disabled) {
                    child.onClick?.();
                    onClose();
                  }
                }}
                className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <span className="truncate">{child.label}</span>
                {child.shortcut && (
                  <span className="text-[10px] text-gray-400 font-mono">{child.shortcut}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
}

// ─── The menu bar ─────────────────────────────────────────────────────────────

export default function EditorMenuBar({
  projectName,
  canEdit,
  canUndo,
  canRedo,
  isLayoutSplit,
  onUndo,
  onRedo,
  onFind,
  onSave,
  onCompile,
  onCreateFile,
  onToggleLayout,
  onDownloadZip,
  onShowHistory,
  onInsert,
}: EditorMenuBarProps) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const btnRefs = useRef<Map<string, React.RefObject<HTMLButtonElement | null>>>(new Map());
  // Tracks whether the mouse is over the popup (which is portaled outside the trigger div)
  const popupHovered = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getBtnRef = (label: string) => {
    if (!btnRefs.current.has(label)) btnRefs.current.set(label, { current: null });
    return btnRefs.current.get(label)!;
  };

  /** Schedule close with a small delay so moving from trigger → popup doesn't flicker */
  const scheduleClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      if (!popupHovered.current) setOpenMenu(null);
    }, 80);
  };

  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  };

  const menus: MenuDef[] = [
    {
      label: "File",
      items: [
        {
          label: "New file",
          icon: <FilePlus className="w-4 h-4" />,
          onClick: onCreateFile,
          disabled: !canEdit,
        },
        {
          label: "New folder",
          icon: <FolderPlus className="w-4 h-4" />,
          disabled: true,
        },
        {
          label: "Upload file",
          icon: <Upload className="w-4 h-4" />,
          disabled: !canEdit,
        },
        {
          label: "Download ZIP",
          icon: <Download className="w-4 h-4" />,
          onClick: onDownloadZip,
          divider: true,
        },
        {
          label: "Version history",
          icon: <History className="w-4 h-4" />,
          onClick: onShowHistory,
        },
        {
          label: "Save",
          icon: <ClipboardList className="w-4 h-4" />,
          shortcut: "Ctrl S",
          onClick: onSave,
          divider: true,
        },
      ],
    },
    {
      label: "Edit",
      items: [
        {
          label: "Undo",
          icon: <Undo2 className="w-4 h-4" />,
          shortcut: "Ctrl Z",
          onClick: onUndo,
          disabled: !canUndo || !canEdit,
        },
        {
          label: "Redo",
          icon: <Redo2 className="w-4 h-4" />,
          shortcut: "Ctrl Y",
          onClick: onRedo,
          disabled: !canRedo || !canEdit,
        },
        {
          label: "Find / Replace",
          icon: <Search className="w-4 h-4" />,
          shortcut: "Ctrl F",
          onClick: onFind,
          divider: true,
        },
        {
          label: "Select all",
          shortcut: "Ctrl A",
          disabled: true,
        },
      ],
    },
    {
      label: "Insert",
      items: [
        {
          label: "Math",
          icon: <Hash className="w-4 h-4" />,
          children: [
            { label: "Inline math  $…$", onClick: () => onInsert("$  $") },
            { label: "Display math $$…$$", onClick: () => onInsert("$$\n\n$$") },
            { label: "Equation", onClick: () => onInsert("\\begin{equation}\n\n\\end{equation}") },
            { label: "Align", onClick: () => onInsert("\\begin{align}\n\n\\end{align}") },
          ],
        },
        {
          label: "Table",
          icon: <Table2 className="w-4 h-4" />,
          onClick: () => onInsert("\\begin{tabular}{|c|c|}\n\\hline\n a & b \\\\\n\\hline\n\\end{tabular}"),
        },
        {
          label: "Figure",
          icon: <LayoutTemplate className="w-4 h-4" />,
          onClick: () => onInsert("\\begin{figure}[h]\n  \\centering\n  \\includegraphics[width=0.5\\textwidth]{filename}\n  \\caption{Caption}\n  \\label{fig:label}\n\\end{figure}"),
        },
        {
          label: "Link",
          icon: <Link className="w-4 h-4" />,
          onClick: () => onInsert("\\href{https://}{text}"),
        },
        {
          label: "Comment",
          icon: <MessageSquare className="w-4 h-4" />,
          onClick: () => onInsert("% "),
        },
      ],
    },
    {
      label: "Format",
      items: [
        {
          label: "Bold",
          icon: <Bold className="w-4 h-4" />,
          shortcut: "Ctrl B",
          onClick: () => onInsert("\\textbf{}"),
          disabled: !canEdit,
        },
        {
          label: "Italics",
          icon: <Italic className="w-4 h-4" />,
          shortcut: "Ctrl I",
          onClick: () => onInsert("\\textit{}"),
          disabled: !canEdit,
        },
        {
          label: "Bullet list",
          icon: <List className="w-4 h-4" />,
          onClick: () => onInsert("\\begin{itemize}\n  \\item \n\\end{itemize}"),
          disabled: !canEdit,
          divider: true,
        },
        {
          label: "Numbered list",
          icon: <ListOrdered className="w-4 h-4" />,
          onClick: () => onInsert("\\begin{enumerate}\n  \\item \n\\end{enumerate}"),
          disabled: !canEdit,
        },
        {
          label: "Increase indent",
          icon: <IndentIncrease className="w-4 h-4" />,
          disabled: !canEdit,
          divider: true,
        },
        {
          label: "Decrease indent",
          icon: <IndentDecrease className="w-4 h-4" />,
          disabled: !canEdit,
        },
        {
          label: "Paragraph styles",
          divider: true,
          children: [
            { label: "Section", onClick: () => onInsert("\\section{}") },
            { label: "Subsection", onClick: () => onInsert("\\subsection{}") },
            { label: "Subsubsection", onClick: () => onInsert("\\subsubsection{}") },
            { label: "Paragraph", onClick: () => onInsert("\\paragraph{}") },
          ],
        },
      ],
    },
    {
      label: "View",
      items: [
        {
          label: isLayoutSplit ? "Editor only" : "Split view",
          icon: <SplitSquareHorizontal className="w-4 h-4" />,
          onClick: onToggleLayout,
        },
        {
          label: "PDF only",
          icon: <PanelLeft className="w-4 h-4" />,
          disabled: true,
        },
        {
          label: "Focus mode",
          icon: <Maximize2 className="w-4 h-4" />,
          shortcut: "Ctrl Shift M",
          disabled: true,
          divider: true,
        },
        {
          label: "Compile",
          shortcut: "Ctrl ↵",
          onClick: onCompile,
        },
      ],
    },
    {
      label: "Help",
      items: [
        {
          label: "Keyboard shortcuts",
          icon: <Keyboard className="w-4 h-4" />,
          disabled: true,
        },
        {
          label: "Documentation",
          icon: <HelpCircle className="w-4 h-4" />,
          onClick: () => window.open("https://www.latex-project.org/help/documentation/", "_blank"),
          divider: true,
        },
        {
          label: "Contact admin",
          icon: <Mail className="w-4 h-4" />,
          disabled: true,
        },
      ],
    },
  ];

  return (
    <div className="h-8 shrink-0 bg-white border-b border-gray-200 flex items-center px-2 gap-0.5 select-none">
      {menus.map((menu) => {
        const ref = getBtnRef(menu.label);
        const isOpen = openMenu === menu.label;

        return (
          <div
            key={menu.label}
            className="relative"
            onMouseEnter={() => { cancelClose(); setOpenMenu(menu.label); }}
            onMouseLeave={scheduleClose}
          >
            <button
              ref={ref as React.RefObject<HTMLButtonElement>}
              type="button"
              className={`h-6 px-2.5 rounded text-[13px] font-medium transition-colors ${
                isOpen
                  ? "bg-gray-100 text-gray-900"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              }`}
            >
              {menu.label}
            </button>

            {isOpen && (
              <MenuPopup
                items={menu.items}
                anchorRef={ref}
                onClose={() => setOpenMenu(null)}
                onPopupMouseEnter={() => { popupHovered.current = true; cancelClose(); }}
                onPopupMouseLeave={() => { popupHovered.current = false; scheduleClose(); }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
