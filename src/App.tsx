import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";

// Public pages
import Landing from "./pages/Landing";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";
import Pricing from "./pages/Pricing";

// Protected pages
import Onboarding from "./pages/Onboarding";
import Connections from "./pages/Connections";
import Dashboard from "./pages/Dashboard";
import Resume from "./pages/Resume";
import Settings from "./pages/Settings";
import JobAgent from "./pages/JobAgent";
import AutoShop from "./pages/AutoShop";
import AgentMonitoring from "./pages/AgentMonitoring";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          {/* Public routes */}
          <Route path="/" element={<Landing />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/pricing" element={<Pricing />} />
          
          {/* Onboarding flow (protected) */}
          <Route
            path="/onboarding"
            element={
              <ProtectedRoute>
                <Onboarding />
              </ProtectedRoute>
            }
          />
          
          {/* Connections/Authorization page */}
          <Route
            path="/connections"
            element={
              <ProtectedRoute>
                <Connections />
              </ProtectedRoute>
            }
          />
          
          {/* Main Dashboard */}
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          
          {/* Resume management */}
          <Route
            path="/resume"
            element={
              <ProtectedRoute>
                <Resume />
              </ProtectedRoute>
            }
          />
          
          {/* Settings */}
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <Settings />
              </ProtectedRoute>
            }
          />
          
          {/* Job search agent */}
          <Route
            path="/jobs"
            element={
              <ProtectedRoute>
                <JobAgent />
              </ProtectedRoute>
            }
          />
          
          {/* Auto-Shop (secondary feature) */}
          <Route
            path="/shop"
            element={
              <ProtectedRoute>
                <AutoShop />
              </ProtectedRoute>
            }
          />
          
          {/* Agent Monitoring */}
          <Route
            path="/monitoring"
            element={
              <ProtectedRoute>
                <AgentMonitoring />
              </ProtectedRoute>
            }
          />
          
          {/* Catch-all */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
