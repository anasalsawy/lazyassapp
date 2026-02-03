import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import Resume from "./pages/Resume";
import Jobs from "./pages/Jobs";
import Applications from "./pages/Applications";
import Messages from "./pages/Messages";
import Settings from "./pages/Settings";
import Automation from "./pages/Automation";
import AutoShop from "./pages/AutoShop";
import { DashboardLayout } from "./layouts/DashboardLayout";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/shop" replace />} />
          <Route path="/landing" element={<Index />} />
          <Route path="/auth" element={<Auth />} />
          {/* Main Auto-Shop route */}
          <Route
            path="/shop"
            element={
              <ProtectedRoute>
                <AutoShop />
              </ProtectedRoute>
            }
          />
          {/* Legacy route redirect */}
          <Route path="/auto-shop" element={<Navigate to="/shop" replace />} />
          {/* Hidden job dashboard - still accessible */}
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="resume" element={<Resume />} />
            <Route path="jobs" element={<Jobs />} />
            <Route path="applications" element={<Applications />} />
            <Route path="automation" element={<Automation />} />
            <Route path="messages" element={<Messages />} />
            <Route path="settings" element={<Settings />} />
          </Route>
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
