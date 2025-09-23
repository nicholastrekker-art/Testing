import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldX, ArrowLeft } from "lucide-react";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
  requireAuth?: boolean;
}

export default function ProtectedRoute({ 
  children, 
  requireAdmin = false, 
  requireAuth = false 
}: ProtectedRouteProps) {
  const { isAuthenticated, isAdmin } = useAuth();
  const [, setLocation] = useLocation();

  // If admin is required but user is not admin
  if (requireAdmin && !isAdmin) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center p-6 bg-background">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <ShieldX className="h-8 w-8 text-red-600" />
            </div>
            <CardTitle className="text-2xl text-red-600">Access Denied</CardTitle>
            <CardDescription className="text-base">
              This page is restricted to administrators only.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <p className="text-sm text-muted-foreground">
              You don't have permission to access bot management features. 
              These tools are reserved for system administrators.
            </p>
            <div className="flex flex-col gap-2">
              <Button 
                onClick={() => setLocation("/")}
                className="w-full"
                data-testid="button-return-dashboard"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Return to Dashboard
              </Button>
              <Button 
                onClick={() => setLocation("/guest/verification")}
                variant="outline"
                className="w-full"
                data-testid="button-guest-registration"
              >
                Register Your Bot
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // If auth is required but user is not authenticated
  if (requireAuth && !isAuthenticated) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center p-6 bg-background">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <ShieldX className="h-8 w-8 text-yellow-600" />
            </div>
            <CardTitle className="text-2xl text-yellow-600">Authentication Required</CardTitle>
            <CardDescription className="text-base">
              Please log in to access this page.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <p className="text-sm text-muted-foreground">
              This page requires authentication. Please log in to continue.
            </p>
            <Button 
              onClick={() => setLocation("/")}
              className="w-full"
              data-testid="button-return-home"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Return Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // User has proper access, render the protected content
  return <>{children}</>;
}