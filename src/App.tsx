import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Auth from "./pages/Auth";
import AutoShop from "./pages/AutoShop";
import JobAgent from "./pages/JobAgent";
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
          {/* Main routes */}
          <Route path="/" element={<Navigate to="/shop" replace />} />
          <Route path="/auth" element={<Auth />} />
          
          {/* Auto-Shop (primary) */}
          <Route
            path="/shop"
            element={
              <ProtectedRoute>
                <AutoShop />
              </ProtectedRoute>
            }
          />
          
          {/* Job Agent (simplified) */}
          <Route
            path="/jobs"
            element={
              <ProtectedRoute>
                <JobAgent />
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
