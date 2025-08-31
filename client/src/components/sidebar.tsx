import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";

const navigationItems = [
  { href: "/", label: "Dashboard", icon: "fas fa-tachometer-alt" },
  { href: "/bot-instances", label: "Bot Instances", icon: "fas fa-robot" },
  { href: "/commands", label: "Commands", icon: "fas fa-terminal" },
  { href: "/chatgpt", label: "ChatGPT Integration", icon: "fas fa-brain" },
  { href: "/groups", label: "Group Management", icon: "fas fa-users" },
  { href: "/analytics", label: "Analytics", icon: "fas fa-chart-line" },
  { href: "/settings", label: "Settings", icon: "fas fa-cog" },
];

export default function Sidebar() {
  const [location] = useLocation();

  return (
    <aside className="w-64 bg-card border-r border-border flex flex-col" data-testid="sidebar">
      <div className="p-6 border-b border-border">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
            <i className="fab fa-whatsapp text-primary-foreground text-xl"></i>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">Bot Manager</h1>
            <p className="text-sm text-muted-foreground">WhatsApp Automation</p>
          </div>
        </div>
      </div>
      
      <nav className="flex-1 p-4 space-y-2">
        {navigationItems.map((item) => (
          <Link key={item.href} href={item.href}>
            <a
              className={cn(
                "flex items-center space-x-3 px-3 py-2 rounded-md transition-colors",
                location === item.href
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : "hover:bg-muted text-muted-foreground hover:text-foreground"
              )}
              data-testid={`nav-${item.label.toLowerCase().replace(' ', '-')}`}
            >
              <i className={`${item.icon} w-5`}></i>
              <span>{item.label}</span>
            </a>
          </Link>
        ))}
      </nav>
      
      <div className="p-4 border-t border-border">
        <div className="flex items-center space-x-3 px-3 py-2">
          <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center">
            <i className="fas fa-user text-primary-foreground text-sm"></i>
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">Admin User</p>
            <p className="text-xs text-muted-foreground">Administrator</p>
          </div>
          <button className="text-muted-foreground hover:text-foreground" data-testid="button-logout">
            <i className="fas fa-sign-out-alt"></i>
          </button>
        </div>
      </div>
    </aside>
  );
}
