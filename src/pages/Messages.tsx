import { Mail, Inbox } from "lucide-react";

const Messages = () => {
  return (
    <div className="p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-foreground">Messages</h1>
        <p className="text-muted-foreground mt-1">
          Manage communications with recruiters
        </p>
      </div>

      <div className="glass-card rounded-2xl p-12 text-center">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
          <Inbox className="w-8 h-8 text-primary" />
        </div>
        <h3 className="text-lg font-semibold text-foreground mb-2">No messages yet</h3>
        <p className="text-muted-foreground max-w-sm mx-auto">
          When you receive responses from recruiters or companies, they'll appear here.
        </p>
      </div>
    </div>
  );
};

export default Messages;
