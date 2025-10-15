import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { 
  LayoutDashboard, 
  Bot, 
  Terminal, 
  Settings, 
  LogOut,
  Server,
  Menu,
  X,
  LogIn
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { LoginModal } from "@/components/login-modal";

export default function Sidebar() {
  const [location] = useLocation();
  const { user, isAdmin, logout, login } = useAuth();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);

  const handleLogout = () => {
    // Clear auth state immediately
    logout();
    toast({ title: "Logged out successfully" });
    
    // Optionally notify server (if endpoint exists)
    try {
      apiRequest("POST", "/api/logout").catch(() => {
        // Ignore server errors - client logout is what matters
      });
    } catch (error) {
      // Ignore - client logout already succeeded
    }
  };

  const menuItems = isAdmin ? [
    { icon: LayoutDashboard, label: "Dashboard", path: "/" },
    { icon: Bot, label: "Bot Instances", path: "/bot-instances" },
    { icon: Terminal, label: "Commands", path: "/commands" },
    { icon: Server, label: "Cross-Server Bots", path: "/cross-server-bots" },
    { icon: Settings, label: "Admin Console", path: "/admin" },
  ] : [
    { icon: LayoutDashboard, label: "Dashboard", path: "/" },
    { icon: Bot, label: "My Bots", path: "/guest/bot-management" },
  ];

  return (
    <>
      {/* Mobile Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed top-4 left-4 z-50 lg:hidden bg-primary text-primary-foreground p-2 rounded-lg shadow-lg hover:bg-primary/90 transition-colors"
        aria-label="Toggle menu"
      >
        {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
      </button>

      {/* Overlay for mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-40
        w-64 bg-card border-r border-border flex flex-col
        transform transition-transform duration-300 ease-in-out
        ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="p-4 lg:p-6 border-b border-border">
          <div className="flex items-center gap-2 lg:gap-3">
            <div className="w-8 h-8 lg:w-10 lg:h-10 bg-primary rounded-lg flex items-center justify-center">
              <Bot className="w-5 h-5 lg:w-6 lg:h-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-base lg:text-lg font-bold text-foreground">TREKKER-MD</h1>
              <p className="text-xs text-muted-foreground">Bot Manager</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 lg:p-4 space-y-1 lg:space-y-2 overflow-y-auto">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.path;
            return (
              <Link 
                key={item.path} 
                href={item.path}
                onClick={() => setIsOpen(false)}
                className={`flex items-center gap-2 lg:gap-3 px-3 lg:px-4 py-2.5 lg:py-3 rounded-lg transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Icon className="w-4 h-4 lg:w-5 lg:h-5 flex-shrink-0" />
                <span className="font-medium text-sm lg:text-base">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-3 lg:p-4 border-t border-border">
          <div className="mb-3 lg:mb-4 p-2.5 lg:p-3 bg-muted rounded-lg">
            <p className="text-sm font-medium text-foreground truncate">{user?.username || 'Guest'}</p>
            <p className="text-xs text-muted-foreground">
              {isAdmin ? 'Administrator' : 'Guest User'}
            </p>
          </div>
          {user ? (
            <Button
              onClick={() => {
                handleLogout();
                setIsOpen(false);
              }}
              variant="outline"
              className="w-full text-sm lg:text-base"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Logout
            </Button>
          ) : (
            <Button
              onClick={() => {
                setShowLoginModal(true);
                setIsOpen(false);
              }}
              variant="default"
              className="w-full text-sm lg:text-base"
            >
              <LogIn className="w-4 h-4 mr-2" />
              Admin Login
            </Button>
          )}
        </div>
      </aside>

      <LoginModal
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        onLogin={(token, user) => {
          login(token, user);
          setShowLoginModal(false);
        }}
      />
    </>
  );
}