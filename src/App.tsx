import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/AppLayout";
import DashboardPage from "@/pages/DashboardPage";
import ModelsPage from "@/pages/ModelsPage";
import LiveAnalysisPage from "@/pages/LiveAnalysisPage";
import BenchmarkPage from "@/pages/BenchmarkPage";
import DualChatPage from "@/pages/DualChatPage";
import IncidentPage from "@/pages/IncidentPage";
import SecureScanPage from "@/pages/SecureScanPage";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/models" element={<ModelsPage />} />
            <Route path="/analysis" element={<LiveAnalysisPage />} />
            <Route path="/chat" element={<DualChatPage />} />
            <Route path="/benchmark" element={<BenchmarkPage />} />
            <Route path="/incidents" element={<IncidentPage />} />
            <Route path="/scan" element={<SecureScanPage />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
