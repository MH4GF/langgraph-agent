// agent.mts
import "dotenv/config";

import { Annotation } from "@langchain/langgraph";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { END, START, StateGraph } from "@langchain/langgraph";
import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import { RunnableConfig } from "@langchain/core/runnables";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { createClient } from "@supabase/supabase-js";

// PostgreSQL connection string for Supabase local
const memory = PostgresSaver.fromConnString(
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
);

// Setup the PostgreSQL checkpointer
await memory.setup();

// Initialize Supabase client for local development
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

// Create a new design session
const createDesignSession = async () => {
  const { data, error } = await supabase
    .from("design_sessions")
    .insert({})
    .select()
    .single();
  
  if (error) {
    console.error("Error creating design session:", error);
    throw error;
  }
  
  return data;
};

// type TimelineItem = {
//   id: string;
//   content: string;
// };

const GraphState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
  }),
});

const schemaDesignTool = tool(
  async ({ entityName, requirements }: { entityName: string; requirements: string }) => {
    // This is a placeholder for the actual implementation
    return `Schema design for ${entityName}:
    
Table: ${entityName.toLowerCase()}
Columns:
- id: Primary key (UUID/Integer)
- created_at: Timestamp (NOT NULL)
- updated_at: Timestamp (NOT NULL)

Based on requirements: ${requirements}

Consider adding indexes, constraints, and relationships as needed.`;
  },
  {
    name: "schema_design",
    description:
      "Use to design database schemas, recommend table structures, and help with database modeling.",
    schema: z.object({
      entityName: z.string().describe("The name of the entity/table to design schema for."),
      requirements: z.string().describe("The requirements and specifications for the schema."),
    }),
  }
);

const tools = [schemaDesignTool];

const toolNode = new ToolNode(tools);
const model = new ChatOpenAI({ model: "gpt-4o" });
const boundModel = model.bindTools(tools);

const routeMessage = (state: typeof GraphState.State) => {
  const { messages: timeline } = state;
  const lastMessage = timeline[timeline.length - 1] as AIMessage;
  // If no tools are called, we can finish (respond to the user)
  if (!lastMessage.tool_calls?.length) {
    return END;
  }
  // Otherwise if there is, we continue and call the tools
  return "tools";
};

const callModel = async (
  state: typeof GraphState.State,
  config?: RunnableConfig
) => {
  const { messages } = state;
  const response = await boundModel.invoke(messages, config);
  return { messages: [response] };
};

const workflow = new StateGraph(GraphState)
  .addNode("agent", callModel)
  .addNode("tools", toolNode)
  .addEdge(START, "agent")
  .addConditionalEdges("agent", routeMessage)
  .addEdge("tools", "agent");

const graph = workflow.compile({ checkpointer: memory });

// Create a new design session and use its ID as thread_id
const designSession = await createDesignSession();
const config = { configurable: { thread_id: designSession.id } };

console.log(`Created design session: ${designSession.id}`);

// Get command line arguments (skip first 2 which are node and script path)
const args = process.argv.slice(2);
const userMessage = args.length > 0 ? args.join(" ") : "What's my name?";

let inputs = {
  messages: [new HumanMessage(userMessage)],
};
for await (const { messages } of await graph.stream(inputs, {
  ...config,
  streamMode: "values",
})) {
  const msg = messages[messages?.length - 1];
  console.log(msg);
  console.log("-----\n");
}
