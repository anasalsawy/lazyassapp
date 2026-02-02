import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

interface AgentTask {
  id: string;
  task_type: string;
  status: string;
  payload: any;
  result: any;
  created_at: string;
}

interface AgentLog {
  id: string;
  agent_name: string;
  message: string;
  log_level: string;
  metadata: any;
  created_at: string;
}

export const useAgentOrchestrator = () => {
  const { user, session } = useAuth();
  const [loading, setLoading] = useState(false);
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const { toast } = useToast();

  const callOrchestrator = async (action: string, payload: any = {}) => {
    if (!session?.access_token) {
      toast({ title: "Please sign in", variant: "destructive" });
      return null;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("agent-orchestrator", {
        body: { action, ...payload },
      });

      if (error) throw error;
      return data;
    } catch (error: any) {
      console.error("Orchestrator error:", error);
      toast({
        title: "Agent Error",
        description: error.message || "Failed to execute agent action",
        variant: "destructive",
      });
      return null;
    } finally {
      setLoading(false);
    }
  };

  const startWorkflow = async () => {
    const result = await callOrchestrator("start_workflow");
    if (result?.tasks) {
      setTasks(result.tasks);
      toast({ title: "Workflow started", description: `${result.tasks.length} tasks created` });
    }
    return result;
  };

  const executeTask = async (taskId: string) => {
    const result = await callOrchestrator("execute_task", { payload: { taskId } });
    if (result?.success) {
      toast({ title: "Task completed" });
    }
    return result;
  };

  const getStatus = async () => {
    const result = await callOrchestrator("get_status");
    if (result) {
      setTasks(result.tasks || []);
      setLogs(result.logs || []);
    }
    return result;
  };

  const autoApply = async () => {
    const result = await callOrchestrator("auto_apply");
    if (result?.success) {
      toast({ 
        title: "Auto-apply initiated", 
        description: result.message 
      });
    }
    return result;
  };

  return {
    loading,
    tasks,
    logs,
    startWorkflow,
    executeTask,
    getStatus,
    autoApply,
  };
};
