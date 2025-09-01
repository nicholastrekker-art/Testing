import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useState } from "react";
import { LoginModal } from "./login-modal";
import { ValidateCredentialsModal } from "./validate-credentials-modal";
import { Button } from "./ui/button";

const navigationItems = [
  { href: "/", label: "Dashboard", icon: "fas fa-tachometer-alt" },
  { href: "/bot-instances", label: "Bot Instances", icon: "fas fa-robot" },
  { href: "/commands", label: "Commands", icon: "fas fa-terminal" },
  { href: "/chatgpt", label: "ChatGPT Integration", icon: "fas fa-brain" },
  { href: "/groups", label: "Group Management", icon: "fas fa-users" },
  { href: "/analytics", label: "Analytics", icon: "fas fa-chart-line" },
  { href: "/settings", label: "Settings", icon: "fas fa-cog" },
];

const adminNavigationItems = [
  { href: "/admin", label: "Admin Console", icon: "fas fa-shield-alt" },
];

export default function Sidebar() {
  const [location] = useLocation();
  const { user, isAuthenticated, isAdmin, logout } = useAuth();
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showValidateModal, setShowValidateModal] = useState(false);

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
            <div
              className={cn(
                "flex items-center space-x-3 px-3 py-2 rounded-md transition-colors cursor-pointer",
                location === item.href
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : "hover:bg-muted text-muted-foreground hover:text-foreground"
              )}
              data-testid={`nav-${item.label.toLowerCase().replace(' ', '-')}`}
            >
              <i className={`${item.icon} w-5`}></i>
              <span>{item.label}</span>
            </div>
          </Link>
        ))}
        
        {/* Admin-only navigation */}
        {isAdmin && (
          <>
            <div className="border-t border-border my-4"></div>
            <div className="px-3 py-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Administration
              </p>
            </div>
            {adminNavigationItems.map((item) => (
              <Link key={item.href} href={item.href}>
                <div
                  className={cn(
                    "flex items-center space-x-3 px-3 py-2 rounded-md transition-colors cursor-pointer",
                    location === item.href
                      ? "bg-red-500/10 text-red-600 border border-red-500/20"
                      : "hover:bg-red-500/5 text-muted-foreground hover:text-red-600"
                  )}
                  data-testid={`nav-${item.label.toLowerCase().replace(' ', '-')}`}
                >
                  <i className={`${item.icon} w-5`}></i>
                  <span>{item.label}</span>
                </div>
              </Link>
            ))}
          </>
        )}
      </nav>
      
      {/* Validate Credentials Button (always available) */}
      <div className="p-4 border-t border-border">
        <Button 
          onClick={() => setShowValidateModal(true)}
          variant="outline" 
          className="w-full mb-3"
        >
          <i className="fas fa-check-circle mr-2"></i>
          Validate Credentials
        </Button>
      </div>
      
      <div className="p-4 border-t border-border">
        {isAuthenticated ? (
          <div className="flex items-center space-x-3 px-3 py-2">
            <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center">
              <i className="fas fa-user text-primary-foreground text-sm"></i>
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">{user?.username || 'User'}</p>
              <p className="text-xs text-muted-foreground">{isAdmin ? 'Administrator' : 'User'}</p>
            </div>
            <button 
              onClick={logout}
              className="text-muted-foreground hover:text-foreground" 
              data-testid="button-logout"
              title="Logout"
            >
              <i className="fas fa-sign-out-alt"></i>
            </button>
          </div>
        ) : (
          <Button 
            onClick={() => setShowLoginModal(true)}
            className="w-full"
          >
            <i className="fas fa-sign-in-alt mr-2"></i>
            Admin Login
          </Button>
        )}
      </div>
      
      <LoginModal 
        isOpen={showLoginModal} 
        onClose={() => setShowLoginModal(false)}
        onLogin={(token, user) => {
          // The login is handled by the useAuth hook
          setShowLoginModal(false);
        }} 
      />
      
      <ValidateCredentialsModal 
        isOpen={showValidateModal} 
        onClose={() => setShowValidateModal(false)}
      />
    </aside>
  );
}
