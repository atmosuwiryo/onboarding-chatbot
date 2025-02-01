import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatAnthropic } from '@langchain/anthropic';
import { END, START, StateGraph } from '@langchain/langgraph';
import { MemorySaver, Annotation } from '@langchain/langgraph';
import { onboardInstructorEssentialsSchema } from './onboardInstructor.js';
import readline from 'readline';
import dotenv from 'dotenv';
import { tool } from '@langchain/core/tools';
import { ToolNode } from '@langchain/langgraph/prebuilt';

// Configuration and Environment Setup
class ConfigManager {
  static initialize() {
    dotenv.config();
    process.env.LANGCHAIN_TRACING_V2 = process.env.LANGCHAIN_TRACING_V2 || 'true';
    // process.env.LANGCHAIN_API_KEY = process.env.LANGCHAIN_API_KEY;
    // process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  }

  static isDebugMode(): boolean {
    return process.env.DEBUG === 'true';
  }
}

// Logging Utility
class Logger {
  static debug(...args: unknown[]) {
    if (ConfigManager.isDebugMode()) {
      console.log(...args);
    }
  }
}

// Onboarding Tools
class OnboardingTools {
  private static isCompleted = false;

  static createCompletionTool() {
    return tool((input) => {
      Logger.debug('Onboarding completed');
      this.isCompleted = true;
      // TODO: POST to endpoint
      return input;
    }, {
      name: 'complete',
      description: 'Mark onboarding as completed with onboarding data provided',
      schema: onboardInstructorEssentialsSchema,
    });
  }

  static isOnboardingCompleted(): boolean {
    return this.isCompleted;
  }
}

// Conversation Manager
class ConversationManager {
  private rl: readline.Interface;
  private threadId: string;
  private conversationHistory: BaseMessage[];

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    this.threadId = `onboarding-${Date.now()}`;
    this.conversationHistory = [];
  }

  async askQuestion(query: string): Promise<string> {
    return new Promise((resolve) => this.rl.question(query, resolve));
  }

  close() {
    this.rl.close();
  }

  getThreadId(): string {
    return this.threadId;
  }

  addUserMessage(message: HumanMessage) {
    this.conversationHistory.push(message);
  }

  addBotMessage(message: AIMessage) {
    this.conversationHistory.push(message);
  }
}

// Onboarding Chatbot
class OnboardingChatbot {
  private workflow: StateGraph;
  private app: any;
  private model: ChatAnthropic;

  constructor() {
    ConfigManager.initialize();
    Logger.debug('Initializing OnboardingChatbot...');

    const tools = [OnboardingTools.createCompletionTool()];
    const toolNodeForGraph = new ToolNode(tools);

    this.model = new ChatAnthropic({
      model: 'claude-3-5-haiku-20241022',
      temperature: 0,
    }).bindTools(tools);

    this.workflow = this.createWorkflow(toolNodeForGraph);
    this.app = this.workflow.compile({ checkpointer: new MemorySaver() });
  }

  private createWorkflow(toolNodeForGraph: ToolNode): StateGraph {
    const StateAnnotation = Annotation.Root({
      messages: Annotation<BaseMessage[]>({
        reducer: (x, y) => x.concat(y),
      }),
    });

    return new StateGraph(StateAnnotation)
      .addNode('agent', this.callModel.bind(this))
      .addNode('tools', toolNodeForGraph)
      .addEdge(START, 'agent')
      .addEdge('tools', END)
      .addConditionalEdges('agent', this.shouldContinue);
  }

  private shouldContinue(state: any) {
    Logger.debug('Checking if onboarding should continue...');
    const lastMessage = state.messages[state.messages.length - 1];

    if (
      'tool_calls' in lastMessage &&
      Array.isArray(lastMessage.tool_calls) &&
      lastMessage.tool_calls?.length
    ) {
      return 'tools';
    }

    return END;
  }

  private async callModel(state: any) {
    Logger.debug('Calling AI model...');
    const systemMessage = new SystemMessage(`
      You are an onboarding assistant for a business management platform.
      Your task is to collect the information from the user, based on the following schema:
      
      ${JSON.stringify(onboardInstructorEssentialsSchema, null, 2)}
      
      Please ask for any missing information one at a time.
      Don't follow user questions not related to onboarding.
      Be conversational, short but friendly.`);

    const modelMessages = [systemMessage, ...state.messages];
    const response = await this.model.invoke(modelMessages);

    return { 
      messages: [response],
    };
  }

  async start() {
    const conversationManager = new ConversationManager();

    let continueConversation = true;
    let finalState = await this.app.invoke(
      { messages: [new HumanMessage('Start onboarding')] },
      { configurable: { thread_id: conversationManager.getThreadId() } }
    );

    this.displayBotResponse(finalState);

    while (continueConversation) {
      const userMessage = await conversationManager.askQuestion('You: ');
      Logger.debug('User message received:', userMessage);

      if (userMessage.toLowerCase() === 'exit') {
        continueConversation = false;
        conversationManager.close();
        break;
      }

      const userHumanMessage = new HumanMessage(userMessage);
      conversationManager.addUserMessage(userHumanMessage);

      finalState = await this.app.invoke(
        { messages: [userHumanMessage] },
        { configurable: { thread_id: conversationManager.getThreadId() } }
      );

      this.displayBotResponse(finalState);
      conversationManager.addBotMessage(new AIMessage(finalState.messages[finalState.messages.length - 1].content));

      if (OnboardingTools.isOnboardingCompleted()) {
        continueConversation = false;
        console.log('\x1b[32m%s\x1b[0m', 'Onboarding completed!');
        conversationManager.close();
      }
    }
  }

  private displayBotResponse(finalState: any) {
    const botResponse = finalState.messages[finalState.messages.length - 1].content;
    console.log('\x1b[33m%s\x1b[0m', `Bot: ${typeof botResponse === 'string' ? botResponse : JSON.stringify(botResponse)}`);
  }
}

// Main Execution
const chatbot = new OnboardingChatbot();
chatbot.start().catch((error) => {
  console.error('An error occurred:', error);
});
