import { Suspense, lazy } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/AppLayout";
import { instrumentedLazyImport } from "@/lib/diagnostics";
import { I18nProvider } from "@/lib/i18n";

const DashboardPage = lazy(instrumentedLazyImport("DashboardPage", () => import("@/pages/DashboardPage")));
const ModelsPage = lazy(instrumentedLazyImport("ModelsPage", () => import("@/pages/ModelsPage")));
const LiveAnalysisPage = lazy(instrumentedLazyImport("LiveAnalysisPage", () => import("@/pages/LiveAnalysisPage")));
const BenchmarkPage = lazy(instrumentedLazyImport("BenchmarkPage", () => import("@/pages/BenchmarkPage")));
const DualChatPage = lazy(instrumentedLazyImport("DualChatPage", () => import("@/pages/DualChatPage")));
const IncidentPage = lazy(instrumentedLazyImport("IncidentPage", () => import("@/pages/IncidentPage")));
const LLMInfoPage = lazy(instrumentedLazyImport("LLMInfoPage", () => import("@/pages/LLMInfoPage")));
const RC21DashboardPage = lazy(instrumentedLazyImport("RC21DashboardPage", () => import("@/pages/RC21DashboardPage")));
const FiltersDocsPage = lazy(instrumentedLazyImport("FiltersDocsPage", () => import("@/pages/FiltersDocsPage")));
const SimulatorPage = lazy(instrumentedLazyImport("SimulatorPage", () => import("@/pages/SimulatorPage")));
const SpecPage = lazy(instrumentedLazyImport("SpecPage", () => import("@/pages/SpecPage")));
const DiagnosticsPage = lazy(instrumentedLazyImport("DiagnosticsPage", () => import("@/pages/DiagnosticsPage")));
const AuthPage = lazy(instrumentedLazyImport("AuthPage", () => import("@/pages/AuthPage")));
const NotFound = lazy(instrumentedLazyImport("NotFound", () => import("./pages/NotFound.tsx")));

const queryClient = new QueryClient();

const RouteFallback = () => (
  <div className="flex min-h-[40vh] items-center justify-center p-8">
    <div className="rounded-xl border border-primary/20 bg-card px-6 py-4 text-sm text-muted-foreground">
      Loading ALFA module...
    </div>
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <I18nProvider>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/models" element={<ModelsPage />} />
              <Route path="/analysis" element={<LiveAnalysisPage />} />
              <Route path="/chat" element={<DualChatPage />} />
              <Route path="/benchmark" element={<BenchmarkPage />} />
              <Route path="/incidents" element={<IncidentPage />} />
              <Route path="/llm" element={<LLMInfoPage />} />
              <Route path="/rc21" element={<RC21DashboardPage />} />
              <Route path="/filters" element={<FiltersDocsPage />} />
              <Route path="/simulator" element={<SimulatorPage />} />
              <Route path="/spec" element={<SpecPage />} />
              <Route path="/diagnostics" element={<DiagnosticsPage />} />
              <Route path="/auth" element={<AuthPage />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
    </I18nProvider>
  </QueryClientProvider>
);

export default App;
