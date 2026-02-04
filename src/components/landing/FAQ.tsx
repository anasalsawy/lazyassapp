import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const FAQ_ITEMS = [
  {
    question: "How does Career Compass access my accounts?",
    answer:
      "You log into your email and job sites once through a secure browser session. We save the session tokens (never your passwords) so our AI agent can perform actions on your behalf. You can revoke access at any time from your settings.",
  },
  {
    question: "Is my personal data safe?",
    answer:
      "Yes! We use industry-standard encryption for all data at rest and in transit. Your resume and personal information are never shared with third parties. We only access the minimum data needed to apply to jobs on your behalf.",
  },
  {
    question: "What job sites does the agent support?",
    answer:
      "Currently, we support LinkedIn, Indeed, and Glassdoor. We're constantly adding more platforms based on user requests. The agent can also monitor your email for recruiter messages and interview invitations.",
  },
  {
    question: "Can I control which jobs the agent applies to?",
    answer:
      "Absolutely! You set your preferences for job titles, locations, salary range, and remote/hybrid/on-site options. You can also exclude specific companies. The agent only applies to jobs that match your criteria.",
  },
  {
    question: "What happens if the agent gets stuck on an application?",
    answer:
      "If the agent encounters something it can't handle (like a complex question or CAPTCHA), it will pause and ask for your input. You'll receive a notification and can provide the answer directly in your dashboard.",
  },
  {
    question: "How many applications can the agent submit per day?",
    answer:
      "You can set a daily limit in your settings (default is 20). This helps prevent account flags on job sites and ensures applications are thoughtful rather than spam. Quality over quantity!",
  },
  {
    question: "Can I see what the agent is doing?",
    answer:
      "Yes! Every action is logged. You can view detailed activity logs for each application, see exactly when the agent applied, what information it submitted, and any responses received.",
  },
  {
    question: "What if I want to stop the agent?",
    answer:
      "You can pause or disable the agent at any time from your dashboard. You can also disconnect individual platforms or revoke all access from your settings. Your data will be retained so you can resume later if you choose.",
  },
];

export function FAQ() {
  return (
    <section className="py-20 px-4 bg-secondary/30">
      <div className="container max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Frequently Asked Questions
          </h2>
          <p className="text-muted-foreground text-lg">
            Everything you need to know about automated job hunting
          </p>
        </div>

        <Accordion type="single" collapsible className="w-full">
          {FAQ_ITEMS.map((item, index) => (
            <AccordionItem key={index} value={`item-${index}`}>
              <AccordionTrigger className="text-left">
                {item.question}
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground">
                {item.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
