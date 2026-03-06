import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  LayoutDashboard,
  Sparkles,
  Briefcase,
  FileText,
  Link2,
  ShoppingCart,
  Phone,
  Activity,
  Bot,
  Settings,
  LogOut,
  Search,
  Zap,
  RefreshCw,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

const NAV_COMMANDS = [
  { path: "/dashboard", label: "Dashboard", icon: LayoutDashboard, keywords: "home overview stats" },
  { path: "/agent", label: "Manus Agent", icon: Sparkles, keywords: "ai chat browser automation" },
  { path: "/jobs", label: "Job Agent", icon: Briefcase, keywords: "search find apply jobs" },
  { path: "/resume", label: "Resume", icon: FileText, keywords: "cv resume optimize" },
  { path: "/connections", label: "Connections", icon: Link2, keywords: "linkedin login accounts" },
  { path: "/shop", label: "Auto-Shop", icon: ShoppingCart, keywords: "buy purchase order shopping" },
  { path: "/call-center", label: "Call Center", icon: Phone, keywords: "voice whatsapp phone" },
  { path: "/monitoring", label: "Monitoring", icon: Activity, keywords: "logs runs tasks status" },
  { path: "/lovable-agent", label: "AI Agent", icon: Bot, keywords: "lovable assistant" },
  { path: "/settings", label: "Settings", icon: Settings, keywords: "profile preferences automation account" },
];

const QUICK_ACTIONS = [
  { id: "refresh-statuses", label: "Refresh all application statuses", icon: RefreshCw, keywords: "update check" },
  { id: "find-jobs", label: "Find new jobs", icon: Search, keywords: "search scrape" },
  { id: "run-agent", label: "Start automation pipeline", icon: Zap, keywords: "run execute apply" },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { signOut } = useAuth();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const handleNav = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  const handleAction = async (id: string) => {
    setOpen(false);
    switch (id) {
      case "refresh-statuses":
        await supabase.functions.invoke("job-agent", { body: { action: "check_all_statuses" } });
        break;
      case "find-jobs":
        navigate("/jobs");
        break;
      case "run-agent":
        navigate("/agent");
        break;
    }
  };

  const handleSignOut = () => {
    setOpen(false);
    signOut();
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Quick Actions">
          {QUICK_ACTIONS.map((action) => (
            <CommandItem key={action.id} onSelect={() => handleAction(action.id)} keywords={[action.keywords]}>
              <action.icon className="mr-2 h-4 w-4" />
              {action.label}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Navigation">
          {NAV_COMMANDS.map((item) => (
            <CommandItem key={item.path} onSelect={() => handleNav(item.path)} keywords={[item.keywords]}>
              <item.icon className="mr-2 h-4 w-4" />
              {item.label}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Account">
          <CommandItem onSelect={handleSignOut} keywords={["logout exit"]}>
            <LogOut className="mr-2 h-4 w-4" />
            Sign Out
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
