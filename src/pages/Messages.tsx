import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Inbox, ClipboardList, Mail } from "lucide-react";
import { JobInbox } from "@/components/dashboard/JobInbox";
import { AgentTasks } from "@/components/dashboard/AgentTasks";
import { useAccountAgent } from "@/hooks/useAccountAgent";
import { Badge } from "@/components/ui/badge";

const Messages = () => {
  const [activeTab, setActiveTab] = useState("inbox");
  const { agentTasks } = useAccountAgent();

  return (
    <div className="p-6 lg:p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-foreground">Communications</h1>
        <p className="text-muted-foreground mt-1">
          Manage your job-related emails and agent tasks
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full max-w-md grid-cols-2 mb-6">
          <TabsTrigger value="inbox" className="gap-2">
            <Inbox className="h-4 w-4" />
            Job Inbox
          </TabsTrigger>
          <TabsTrigger value="tasks" className="gap-2">
            <ClipboardList className="h-4 w-4" />
            Agent Tasks
            {agentTasks.length > 0 && (
              <Badge variant="destructive" className="ml-1 h-5 px-1.5">
                {agentTasks.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="inbox">
          <JobInbox />
        </TabsContent>

        <TabsContent value="tasks">
          <AgentTasks />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Messages;
