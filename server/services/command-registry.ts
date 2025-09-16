interface BotCommand {
  name: string;
  aliases?: string[];
  description: string;
  category: string;
  handler: (context: CommandContext) => Promise<void>;
}

interface CommandContext {
  message: any;
  client: any;
  respond: (text: string) => Promise<void>;
  from: string;
  sender: string;
  args: string[];
  command: string;
  prefix: string;
  botId?: string;
}

class CommandRegistry {
  private commands: Map<string, BotCommand> = new Map();

  register(command: BotCommand) {
    this.commands.set(command.name.toLowerCase(), command);

    // Register aliases
    if (command.aliases) {
      command.aliases.forEach(alias => {
        this.commands.set(alias.toLowerCase(), command);
      });
    }
  }

  get(commandName: string): BotCommand | undefined {
    return this.commands.get(commandName.toLowerCase());
  }

  getAllCommands(): BotCommand[] {
    const uniqueCommands = new Map<string, BotCommand>();

    Array.from(this.commands.values()).forEach(command => {
      uniqueCommands.set(command.name, command);
    });

    return Array.from(uniqueCommands.values());
  }

  getCommandsByCategory(): Record<string, BotCommand[]> {
    const commands = this.getAllCommands();
    const categorized: Record<string, BotCommand[]> = {};

    commands.forEach(command => {
      const category = command.category.toUpperCase();
      if (!categorized[category]) {
        categorized[category] = [];
      }
      categorized[category].push(command);
    });

    return categorized;
  }
}

export const commandRegistry = new CommandRegistry();
export type { BotCommand, CommandContext };