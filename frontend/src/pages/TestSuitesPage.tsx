import * as React from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { testSuitesApi, projectsApi } from "@/lib/api";
import type { CreateTestSuite, TestSuite, TestSuiteMode } from "@/lib/types";
import { timeAgo } from "@/lib/format";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { Pagination } from "@/components/shared/Pagination";
import { TypeBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

export function TestSuitesPage() {
    const [params, setParams] = useSearchParams();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [editorOpen, setEditorOpen] = React.useState(false);
    const [editing, setEditing] = React.useState<TestSuite | null>(null);

    const page = Number(params.get("page") ?? "1");
    const projectId = params.get("projectId") ?? "";

    const { data: projects } = useQuery({
        queryKey: ["projects-all"],
        queryFn: () => projectsApi.list(1, 100),
    });

    const { data, isLoading, isError, error } = useQuery({
        queryKey: ["testsuites", page, projectId],
        queryFn: () => testSuitesApi.list({ page, limit: 10, projectId: projectId || undefined }),
    });

    const executeMutation = useMutation({
        mutationFn: (id: string) => testSuitesApi.execute(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["jobs"] });
            navigate("/jobs");
        },
    });

    const onDelete = async (s: TestSuite) => {
        if (!confirm(`Delete test suite ${s.id}? Past reports are kept.`)) return;
        await testSuitesApi.remove(s.id);
        queryClient.invalidateQueries({ queryKey: ["testsuites"] });
    };

    const setParam = (key: string, value: string) => {
        const next = new URLSearchParams(params);
        if (value) next.set(key, value);
        else next.delete(key);
        if (key !== "page") next.delete("page");
        setParams(next);
    };

    const projectName = (id: string) =>
        projects?.projects.find((p) => p.id === id)?.projectName ?? id;

    return (
        <div>
            <PageHeader
                title="Test Suites"
                description="Reusable specifications: the agent writes and runs code against a project's documentation."
                actions={
                    <Button
                        onClick={() => {
                            setEditing(null);
                            setEditorOpen(true);
                        }}
                    >
                        <Plus /> New suite
                    </Button>
                }
            />

            <div className="mb-4">
                <Select
                    className="w-56"
                    value={projectId}
                    onChange={(e) => setParam("projectId", e.target.value)}
                >
                    <option value="">All projects</option>
                    {projects?.projects.map((p) => (
                        <option key={p.id} value={p.id}>{p.projectName}</option>
                    ))}
                </Select>
            </div>

            {isLoading && (
                <div className="space-y-2">
                    {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
                </div>
            )}

            {isError && (
                <Card className="border-failure/30 p-4 text-sm text-failure">
                    Failed to load test suites: {(error as Error).message}
                </Card>
            )}

            {data && data.items.length === 0 && (
                <EmptyState
                    icon={FlaskConical}
                    title="No test suites"
                    description="Define a suite to evaluate a project's documentation by executing generated code."
                    action={
                        <Button
                            onClick={() => {
                                setEditing(null);
                                setEditorOpen(true);
                            }}
                        >
                            <Plus /> New suite
                        </Button>
                    }
                />
            )}

            {data && data.items.length > 0 && (
                <div className="space-y-2">
                    {data.items.map((s) => (
                        <Card key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                            <TypeBadge type={s.mode} />
                            <div className="min-w-0 flex-1">
                                <p className="truncate font-mono text-sm">{s.id}</p>
                                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                    <Link
                                        to={`/projects/${s.projectId}`}
                                        className="text-info hover:underline"
                                    >
                                        {projectName(s.projectId)}
                                    </Link>
                                    {s.userGoal && <> · {s.userGoal}</>}
                                    {!s.userGoal && s.mode === "TEST_SCENARIO" && (
                                        <>
                                            {" "}· {s.minimalStoryLength}–{s.maximalStoryLength}{" "}
                                            steps
                                        </>
                                    )}
                                </p>
                            </div>
                            <span className="text-xs text-muted-foreground">
                                updated {timeAgo(s.updatedAt)}
                            </span>
                            <div className="flex items-center gap-1">
                                <Button
                                    size="sm"
                                    onClick={() => executeMutation.mutate(s.id)}
                                    disabled={executeMutation.isPending}
                                    title="Execute as background job"
                                >
                                    <Play /> Run
                                </Button>
                                <Link to={`/reports?testSuiteId=${s.id}`}>
                                    <Button variant="outline" size="sm">Reports</Button>
                                </Link>
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    title="Edit"
                                    onClick={() => {
                                        setEditing(s);
                                        setEditorOpen(true);
                                    }}
                                >
                                    <Pencil />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    title="Delete"
                                    className="text-muted-foreground hover:text-failure"
                                    onClick={() => onDelete(s)}
                                >
                                    <Trash2 />
                                </Button>
                            </div>
                        </Card>
                    ))}
                    {executeMutation.isError && (
                        <p className="text-sm text-failure">
                            Execution failed to start: {(executeMutation.error as Error).message}
                        </p>
                    )}
                    <Pagination meta={data.meta} onPage={(p) => setParam("page", String(p))} />
                </div>
            )}

            <SuiteEditorDialog
                open={editorOpen}
                onClose={() => setEditorOpen(false)}
                suite={editing}
                projects={projects?.projects ?? []}
                defaultProjectId={projectId}
            />
        </div>
    );
}

function SuiteEditorDialog({
    open,
    onClose,
    suite,
    projects,
    defaultProjectId,
}: {
    open: boolean;
    onClose: () => void;
    suite: TestSuite | null;
    projects: { id: string; projectName: string }[];
    defaultProjectId: string;
}) {
    const queryClient = useQueryClient();
    const [form, setForm] = React.useState<CreateTestSuite>(() => emptyForm(defaultProjectId));

    React.useEffect(() => {
        if (!open) return;
        setForm(
            suite
                ? {
                    projectId: suite.projectId,
                    mode: suite.mode,
                    initialContext: suite.initialContext,
                    functionTemplate: suite.functionTemplate,
                    userGoal: suite.userGoal,
                    minimalStoryLength: suite.minimalStoryLength,
                    maximalStoryLength: suite.maximalStoryLength,
                }
                : emptyForm(defaultProjectId),
        );
    }, [open, suite, defaultProjectId]);

    const mutation = useMutation({
        mutationFn: () =>
            suite ? testSuitesApi.update(suite.id, form) : testSuitesApi.create(form),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["testsuites"] });
            onClose();
        },
    });

    const set = <K extends keyof CreateTestSuite>(key: K, value: CreateTestSuite[K]) =>
        setForm((f) => ({ ...f, [key]: value }));

    return (
        <Dialog
            open={open}
            onClose={onClose}
            title={suite ? `Edit suite ${suite.id}` : "New test suite"}
            className="max-w-2xl"
        >
            <form
                className="space-y-4"
                onSubmit={(e) => {
                    e.preventDefault();
                    mutation.mutate();
                }}
            >
                <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                        <Label>Project</Label>
                        <Select
                            value={form.projectId}
                            onChange={(e) => set("projectId", e.target.value)}
                            required
                        >
                            <option value="">Select project…</option>
                            {projects.map((p) => (
                                <option key={p.id} value={p.id}>{p.projectName}</option>
                            ))}
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label>Mode</Label>
                        <Select
                            value={form.mode}
                            onChange={(e) => set("mode", e.target.value as TestSuiteMode)}
                        >
                            <option value="TEST_SCENARIO">TEST_SCENARIO</option>
                            <option value="CODE_GENERATION">CODE_GENERATION</option>
                        </Select>
                    </div>
                </div>

                {form.mode === "CODE_GENERATION" && (
                    <div className="space-y-2">
                        <Label>User goal</Label>
                        <Textarea
                            value={form.userGoal ?? ""}
                            onChange={(e) => set("userGoal", e.target.value)}
                            placeholder="Create a program that registers a user and fetches their profile."
                        />
                    </div>
                )}

                {form.mode === "TEST_SCENARIO" && (
                    <div className="space-y-2">
                        <Label>Function template</Label>
                        <Textarea
                            value={form.functionTemplate ?? ""}
                            onChange={(e) => set("functionTemplate", e.target.value)}
                            placeholder="function createOrder(context, items) { /* ... */ }"
                        />
                    </div>
                )}

                <div className="space-y-2">
                    <Label>Initial context (JSON string)</Label>
                    <Textarea
                        value={form.initialContext}
                        onChange={(e) => set("initialContext", e.target.value)}
                        placeholder='{"apiBase":"http://host.docker.internal:14000/api/v1","token":"..."}'
                        required
                    />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                        <Label>Min steps</Label>
                        <Input
                            type="number"
                            min={1}
                            value={form.minimalStoryLength}
                            onChange={(e) => set("minimalStoryLength", Number(e.target.value))}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Max steps</Label>
                        <Input
                            type="number"
                            min={1}
                            value={form.maximalStoryLength}
                            onChange={(e) => set("maximalStoryLength", Number(e.target.value))}
                        />
                    </div>
                </div>

                {mutation.isError && (
                    <p className="text-sm text-failure">{(mutation.error as Error).message}</p>
                )}
                <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={onClose}>Cancel</Button>
                    <Button type="submit" disabled={mutation.isPending || !form.projectId}>
                        {mutation.isPending ? "Saving…" : suite ? "Save changes" : "Create suite"}
                    </Button>
                </div>
            </form>
        </Dialog>
    );
}

function emptyForm(projectId: string): CreateTestSuite {
    return {
        projectId,
        mode: "TEST_SCENARIO",
        initialContext: "{}",
        functionTemplate: "",
        userGoal: "",
        minimalStoryLength: 3,
        maximalStoryLength: 8,
    };
}
