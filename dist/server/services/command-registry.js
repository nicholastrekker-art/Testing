class CommandRegistry {
    commands = new Map();
    register(command) {
        this.commands.set(command.name.toLowerCase(), command);
        if (command.aliases) {
            command.aliases.forEach(alias => {
                this.commands.set(alias.toLowerCase(), command);
            });
        }
    }
    get(commandName) {
        return this.commands.get(commandName.toLowerCase());
    }
    getAllCommands() {
        const uniqueCommands = new Map();
        Array.from(this.commands.values()).forEach(command => {
            uniqueCommands.set(command.name, command);
        });
        return Array.from(uniqueCommands.values());
    }
    getCommandsByCategory() {
        const commands = this.getAllCommands();
        const categorized = {};
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
