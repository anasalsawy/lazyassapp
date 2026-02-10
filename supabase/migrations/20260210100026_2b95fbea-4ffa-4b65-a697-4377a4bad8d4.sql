
-- Conversations table: tracks user state through WhatsApp interaction
CREATE TABLE public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  phone_number TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'greeting',
  context_json JSONB NOT NULL DEFAULT '{}',
  last_message_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique constraint: one active conversation per phone number
CREATE UNIQUE INDEX idx_conversations_phone ON public.conversations (phone_number);
CREATE INDEX idx_conversations_user ON public.conversations (user_id);

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own conversations"
  ON public.conversations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own conversations"
  ON public.conversations FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage conversations"
  ON public.conversations FOR ALL
  USING (true)
  WITH CHECK (true);

-- WhatsApp messages table: persistent chat history
CREATE TABLE public.whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  body TEXT NOT NULL,
  media_url TEXT,
  twilio_sid TEXT,
  metadata_json JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_wa_messages_conv ON public.whatsapp_messages (conversation_id, created_at);
CREATE INDEX idx_wa_messages_user ON public.whatsapp_messages (user_id);

ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own messages"
  ON public.whatsapp_messages FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage messages"
  ON public.whatsapp_messages FOR ALL
  USING (true)
  WITH CHECK (true);

-- Trigger for updated_at on conversations
CREATE TRIGGER update_conversations_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();
