import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { ReportsPage } from "@/pages/ReportsPage";
import { ReportDetailPage } from "@/pages/ReportDetailPage";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { ProjectDetailPage } from "@/pages/ProjectDetailPage";
import { TestSuitesPage } from "@/pages/TestSuitesPage";
import { JobsPage } from "@/pages/JobsPage";
import { FilesPage } from "@/pages/FilesPage";
import { PlannerPage } from "@/pages/PlannerPage";
import "./index.css";

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: 1,
            refetchOnWindowFocus: false,
            staleTime: 10_000,
        },
    },
});

const router = createBrowserRouter([
    {
        element: <Layout />,
        children: [
            { path: "/", element: <Navigate to="/projects" replace /> },
            { path: "/reports", element: <ReportsPage /> },
            { path: "/reports/:reportId", element: <ReportDetailPage /> },
            { path: "/projects", element: <ProjectsPage /> },
            { path: "/projects/:projectId", element: <ProjectDetailPage /> },
            { path: "/testsuites", element: <TestSuitesPage /> },
            { path: "/jobs", element: <JobsPage /> },
            { path: "/files", element: <FilesPage /> },
            { path: "/planner", element: <PlannerPage /> },
            { path: "*", element: <Navigate to="/projects" replace /> },
        ],
    },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <QueryClientProvider client={queryClient}>
            <RouterProvider router={router} />
        </QueryClientProvider>
    </React.StrictMode>,
);
