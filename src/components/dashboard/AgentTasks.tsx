import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  ClipboardList,
  ShieldCheck,
  Eye,
  CheckCircle2,
  Clock,
  Loader2,
  Send
} from "lucide-react";
import { useAccountAgent } from "@/hooks/useAccountAgent";
import { formatDistanceToNow } from "date-fns";

const TASK_CONFIG: Record<string, { label: string; icon: React.ReactNode; description: string }> = {
  need_mfa_code: {
    label: "MFA Required",
    icon: <ShieldCheck className="h-4 w-4" />,
    description: "Enter the verification code to continue",
  },
  need_captcha: {
    label: "CAPTCHA Required",
    icon: <Eye className="h-4 w-4" />,
    description: "Complete the CAPTCHA challenge to continue",
  },
  need_user_confirm: {
    label: "Confirmation Needed",
    icon: <CheckCircle2 className="h-4 w-4" />,
    description: "Review and confirm to proceed",
  },
  approve_email: {
    label: "Approve Email",
    icon: <Send className="h-4 w-4" />,
    description: "Review and approve the email draft before sending",
  },
};

export function AgentTasks() {
  const { agentTasks, isLoading, resolveTask, refetchTasks } = useAccountAgent();
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [resolvingTask, setResolvingTask] = useState<string | null>(null);

  const handleResolve = async (taskId: string, taskType: string) => {
    setResolvingTask(taskId);
    try {
      const resolution: Record<string, unknown> = { resolved_at: new Date().toISOString() };
      
      if (taskType === "need_mfa_code") {
        resolution.code = inputValues[taskId] || "";
      }
      
      await resolveTask(taskId, resolution);
      setInputValues((prev) => {
        const next = { ...prev };
        delete next[taskId];
        return next;
      });
    } finally {
      setResolvingTask(null);
    }
  };

  const getTaskConfig = (taskType: string) => {
    return TASK_CONFIG[taskType] || {
      label: taskType,
      icon: <ClipboardList className="h-4 w-4" />,
      description: "Complete this task to continue",
    };
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5" />
          Agent Tasks
          {agentTasks.length > 0 && (
            <Badge variant="destructive" className="ml-2">
              {agentTasks.length} pending
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Actions requiring your input to continue automation
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : agentTasks.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground">
            <CheckCircle2 className="h-12 w-12 mx-auto mb-4 opacity-50 text-green-500" />
            <p>No pending tasks</p>
            <p className="text-sm mt-2">All automation is running smoothly</p>
          </div>
        ) : (
          <ScrollArea className="h-[400px]">
            <div className="space-y-4">
              {agentTasks.map((task) => {
                const config = getTaskConfig(task.task_type);
                const payload = task.payload || {};

                return (
                  <div
                    key={task.id}
                    className="p-4 border rounded-lg border-l-4 border-l-yellow-500"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge className="bg-yellow-500">
                            {config.icon}
                            <span className="ml-1">{config.label}</span>
                          </Badge>
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatDistanceToNow(new Date(task.created_at))} ago
                          </span>
                        </div>

                        <p className="text-sm mb-3">{config.description}</p>

                        {/* Context from payload */}
                        {payload.site && (
                          <p className="text-sm text-muted-foreground mb-2">
                            Site: <span className="font-medium">{payload.site as string}</span>
                          </p>
                        )}

                        {payload.instructions && (
                          <p className="text-sm text-muted-foreground mb-2">
                            {payload.instructions as string}
                          </p>
                        )}

                        {payload.screenshot_url && (
                          <img
                            src={payload.screenshot_url as string}
                            alt="Screenshot"
                            className="rounded-lg border mb-3 max-h-48 object-contain"
                          />
                        )}

                        {/* Input for MFA code */}
                        {task.task_type === "need_mfa_code" && (
                          <Input
                            placeholder="Enter verification code"
                            value={inputValues[task.id] || ""}
                            onChange={(e) =>
                              setInputValues((prev) => ({
                                ...prev,
                                [task.id]: e.target.value,
                              }))
                            }
                            className="max-w-xs mb-3"
                          />
                        )}
                      </div>

                      <Button
                        onClick={() => handleResolve(task.id, task.task_type)}
                        disabled={
                          resolvingTask === task.id ||
                          (task.task_type === "need_mfa_code" && !inputValues[task.id])
                        }
                      >
                        {resolvingTask === task.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <CheckCircle2 className="h-4 w-4 mr-2" />
                            {task.task_type === "need_mfa_code" ? "Submit" : "Confirm"}
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
