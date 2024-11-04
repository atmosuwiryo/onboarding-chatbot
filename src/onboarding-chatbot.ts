import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatAnthropic } from '@langchain/anthropic';
import { END, START, StateGraph } from '@langchain/langgraph';
import { MemorySaver, Annotation } from '@langchain/langgraph';
import { onboardInstructorEssentialsSchema } from './onboardInstructor.js';
import readline from 'readline';
import dotenv from 'dotenv';
import { tool } from '@langchain/core/tools';
import { ToolNode } from '@langchain/langgraph/prebuilt';

dotenv.config();

// Set LangChain environment variables programmatically
process.env.LANGCHAIN_TRACING_V2 = process.env.LANGCHAIN_TRACING_V2 || 'true';
process.env.LANGCHAIN_API_KEY = process.env.LANGCHAIN_API_KEY;
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Add DEBUG environment variable
const DEBUG = process.env.DEBUG === 'true';

// Define a debug logger function
function debugLog(...args: unknown[]) {
  if (DEBUG) {
    console.log(...args);
  }
}
debugLog('Environment variables set');

let isCompleted = false;

// Define the graph state
const StateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
  }),
});
debugLog('StateAnnotation defined');

const onboardingCompleted = tool((input) => {
  debugLog('Onboarding completed');
  isCompleted = true;

  // TODO: POST to endpoint
  return input;
}, {
  name: 'complete',
  description: 'Mark onboarding as completed with onboarding data provided',
  schema: onboardInstructorEssentialsSchema,
});

const tools = [onboardingCompleted];
debugLog('Tools defined');

const model = new ChatAnthropic({
  model: 'claude-3-5-sonnet-20240620',
  temperature: 0,
}).bindTools(tools);
debugLog('ChatAnthropic model initialized');

const toolNodeForGraph = new ToolNode(tools);

// Define the function that determines whether to continue or not
function shouldContinue(state: typeof StateAnnotation.State) {
  debugLog('Checking if onboarding should continue...');

  const lastMessage = state.messages[state.messages.length - 1];

  // If the LLM makes a tool call, then we route to the "tools" node
  if (
    'tool_calls' in lastMessage&&
    Array.isArray(lastMessage.tool_calls) &&
    lastMessage.tool_calls?.length) {
    return 'tools';
  }

  // Back to ask for user input
  return END;
}

// Define the function that calls the model
async function callModel(state: typeof StateAnnotation.State) {
  debugLog('Calling AI model...');
  const messages = state.messages;

  // Construct a system message that guides the model to collect missing information
  const systemMessage = new SystemMessage(`
You are an onboarding assistant for a business management platform.
Your task is to collect the information from the user, based on the following schema:

${JSON.stringify(onboardInstructorEssentialsSchema, null, 2)}

Please ask for any missing information one at a time.
Don't follow user question not related to onboarding.
Be conversational, short but friendly.`);

  debugLog('System message created');

  // Prepare the messages for the model
  const modelMessages = [systemMessage, ...messages]; // Only include the last user message
  debugLog('model messages prepared:', modelMessages);

  debugLog('Invoking AI model...');
  const response = await model.invoke(modelMessages);
  debugLog('AI model response received');

  return { 
    messages: [response], // Only return the new assistant message
  };
}


// Define a new graph
debugLog('Defining StateGraph...');
const workflow = new StateGraph(StateAnnotation)
  .addNode('agent', callModel)
  .addNode('tools', toolNodeForGraph)
  .addEdge(START, 'agent')
  .addEdge('tools', END)
  .addConditionalEdges('agent', shouldContinue);
debugLog('StateGraph defined');

// Initialize memory to persist state between graph runs
const checkpointer = new MemorySaver();
debugLog('MemorySaver initialized');

// Compile the graph
debugLog('Compiling the graph...');
const app = workflow.compile({ checkpointer });
debugLog('Graph compiled');

async function main() {
  debugLog('Starting main function...');

  // If onboarding has already been completed, exit
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const askQuestion = (query: string): Promise<string> => {
    return new Promise((resolve) => rl.question(query, resolve));
  };

  let continueConversation = true;
  const threadId = 'onboarding-' + Date.now(); // Unique thread ID for this onboarding session
  debugLog('Thread ID:', threadId);
  const conversationHistory: BaseMessage[] = [];

  debugLog('Starting conversation...');
  let finalState = await app.invoke(
    { 
      messages: [new HumanMessage('Start onboarding')],
    },
    { configurable: { thread_id: threadId } }
  );
  const botResponse = finalState.messages[finalState.messages.length - 1].content; // Get the new assistant message
  console.log('\x1b[33m%s\x1b[0m', `Bot: ${typeof botResponse === 'string' ? botResponse : JSON.stringify(botResponse)}`);

  while (continueConversation) {

    debugLog('Waiting for user input...');
    const userMessage = await askQuestion('You: ');
    debugLog('User message received:', userMessage);

    if (userMessage.toLowerCase() === 'exit') {
      continueConversation = false;
      debugLog('User requested to exit. Ending conversation.');
      rl.close();
      break;
    }

    const userHumanMessage = new HumanMessage(userMessage);
    conversationHistory.push(userHumanMessage);

    debugLog('Invoking app with user message...');
    finalState = await app.invoke(
      { 
        messages: [userHumanMessage],
      },
      { configurable: { thread_id: threadId } }
    );
    debugLog('App invocation complete');

    const botResponse = finalState.messages[finalState.messages.length - 1].content; // Get the new assistant message
    console.log('\x1b[33m%s\x1b[0m', `Bot: ${typeof botResponse === 'string' ? botResponse : JSON.stringify(botResponse)}`);

    // Add the bot's response to the conversation history
    conversationHistory.push(new AIMessage(botResponse));

    // If onboarding has already been completed, exit
    if (isCompleted)
    {
      continueConversation = false;
      console.log('\x1b[32m%s\x1b[0m', 'Onboarding completed!');
      rl.close();
    }

  }

  debugLog('Main function completed');
}

debugLog('Starting the onboarding chatbot...');
main().catch((error) => {
  console.error('An error occurred:', error);
});
