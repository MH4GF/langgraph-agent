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

// PostgreSQL connection string for Supabase local
const memory = PostgresSaver.fromConnString(
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
);

// Setup the PostgreSQL checkpointer
await memory.setup();

// type TimelineItem = {
//   id: string;
//   content: string;
// };

const GraphState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
  }),
});

const searchTool = tool(
  async ({}: { query: string }) => {
    // This is a placeholder for the actual implementation
    return "Cold, with a low of 13 ℃";
  },
  {
    name: "search",
    description:
      "Use to surf the web, fetch current information, check the weather, and retrieve other information.",
    schema: z.object({
      query: z.string().describe("The query to use in your search."),
    }),
  }
);

const tools = [searchTool];

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

const config = { configurable: { thread_id: "conversation-num-1" } };
let inputs = {
  messages: [new HumanMessage("What's my name?")],
};
for await (const { messages } of await graph.stream(inputs, {
  ...config,
  streamMode: "values",
})) {
  let msg = messages[messages?.length - 1];
  if (msg?.content) {
    console.log(msg.content);
  } else if (msg?.tool_calls?.length > 0) {
    console.log(msg.tool_calls);
  } else {
    console.log(msg);
  }
  console.log("-----\n");
}
