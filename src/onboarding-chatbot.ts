import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatAnthropic } from '@langchain/anthropic';
import { StateGraph } from '@langchain/langgraph';
import { MemorySaver, Annotation } from '@langchain/langgraph';
import readline from 'readline';
import dotenv from 'dotenv';

dotenv.config();

// Set LangChain environment variables programmatically
process.env.LANGCHAIN_TRACING_V2 = process.env.LANGCHAIN_TRACING_V2 || 'true';
// eslint-disable-next-line no-self-assign
process.env.LANGCHAIN_API_KEY = process.env.LANGCHAIN_API_KEY;
// eslint-disable-next-line no-self-assign
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

// Define the graph state
const StateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
  }),
  onboardingData: Annotation<Partial<OnboardTenantEssentials>>({
    reducer: (prev, next) => ({ ...prev, ...next }),
  }),
});

debugLog('StateAnnotation defined');

interface OnboardTenantEssentials {
  businessName: string;
  firstServices: {
    serviceName: string;
    price: number;
    priceCurrency: string;
    durationInMinutes: number;
  };
  businessHours: Array<{
    startTime24hr: string;
    endTime24hr: string;
    dayOfWeek: 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';
  }>;
  yourEmailAddress: string;
  doYouWantUsToTakePaymentsDirectlyFromYourCustomers: boolean;
}

debugLog('OnboardTenantEssentials interface defined');

const model = new ChatAnthropic({
  model: 'claude-3-5-sonnet-20240620',
  temperature: 0,
});

debugLog('ChatAnthropic model initialized');

// Define the function that determines whether to continue or not
function shouldContinue(state: typeof StateAnnotation.State) {
  debugLog('Checking if onboarding should continue...');
  const onboardingData = state.onboardingData;
  if (
    onboardingData.businessName &&
    onboardingData.firstServices &&
    onboardingData.businessHours &&
    onboardingData.yourEmailAddress !== undefined &&
    onboardingData.doYouWantUsToTakePaymentsDirectlyFromYourCustomers !== undefined
  ) {
    debugLog('Onboarding complete. Ending process.');
    return '__end__';
  }
  debugLog('Onboarding incomplete. Continuing process.');
  // return "agent";
  return '__end__';
}

// Define the function that calls the model
async function callModel(state: typeof StateAnnotation.State) {
  debugLog('Calling AI model...');
  const messages = state.messages;
  const onboardingData = state.onboardingData;

  // Construct a system message that guides the model to collect missing information
  const systemMessage = new SystemMessage(`You are an onboarding assistant for a business management platform. Your task is to collect the following information from the user:

1. Business name
2. First service details (name, price, currency, duration in minutes)
3. Business hours for each day of the week
4. Email address
5. Whether they want us to take payments directly from customers

Current progress:
${JSON.stringify(onboardingData, null, 2)}

Please ask for any missing information one at a time. Be conversational and friendly.`);

  debugLog('System message created');

  // Prepare the messages for the model
  // const modelMessages = [systemMessage, ...messages.slice(-1)]; // Only include the last user message
  const modelMessages = [systemMessage, ...messages]; // Only include the last user message
  // const modelMessages = messages; // Only include the last user message
  debugLog('model messages prepared:', modelMessages);

  debugLog('Invoking AI model...');
  const response = await model.invoke(modelMessages);
  debugLog('AI model response received');

  // Parse the response to extract any new information
  debugLog('Parsing AI response for new data...');
  const newData = parseResponseForData(response.content);
  debugLog('New data parsed:', newData);

  return { 
    messages: [response], // Only return the new assistant message
    onboardingData: newData
  };
}

function parseResponseForData(content: string | object): Partial<OnboardTenantEssentials> {
  debugLog('Parsing response for onboarding data...');
  // Convert content to string if it's an object
  const contentString = typeof content === 'object' ? JSON.stringify(content) : content;
  
  const newData: Partial<OnboardTenantEssentials> = {};

  if (contentString.includes('business name') && contentString.includes(':')) {
    newData.businessName = contentString.split(':')[1].trim();
    debugLog('Extracted business name:', newData.businessName);
  }

  // Add more parsing logic for other fields...

  debugLog('Parsed data:', newData);
  return newData;
}

// Define a new graph
debugLog('Defining StateGraph...');
const workflow = new StateGraph(StateAnnotation)
  .addNode('agent', callModel)
  .addEdge('__start__', 'agent')
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

  while (continueConversation) {
    debugLog('Waiting for user input...');
    const userMessage = await askQuestion('You: ');
    if (userMessage.toLowerCase() === 'exit') {
      continueConversation = false;
      debugLog('User requested to exit. Ending conversation.');
      rl.close();
      break;
    }

    debugLog('User message received:', userMessage);
    const userHumanMessage = new HumanMessage(userMessage);
    conversationHistory.push(userHumanMessage);

    debugLog('Invoking app with user message...');
    const finalState = await app.invoke(
      { 
        messages: [userHumanMessage],
        onboardingData: {} // Initialize with empty object on first run
      },
      { configurable: { thread_id: threadId } }
    );
    debugLog('App invocation complete');

    const botResponse = finalState.messages[finalState.messages.length - 1].content; // Get the new assistant message
    // console.log("Bot response:", botResponse);
    console.log('\x1b[33m%s\x1b[0m', `Bot: ${typeof botResponse === 'string' ? botResponse : JSON.stringify(botResponse)}`);

    // Add the bot's response to the conversation history
    conversationHistory.push(new AIMessage(botResponse));

    // if (shouldContinue(finalState) === "__end__") {
    //   debugLog("Onboarding complete. Displaying collected information:");
    //   debugLog(JSON.stringify(finalState.onboardingData, null, 2));
    //   continueConversation = false;
    //   rl.close();
    // }
  }

  debugLog('Main function completed');
}

debugLog('Starting the onboarding chatbot...');
main().catch((error) => {
  console.error('An error occurred:', error);
});
