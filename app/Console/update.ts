import { Command, command } from '@blok-codes/inversify-oclif-utils';
import { Flags, Interfaces } from '@oclif/core';
import fs from 'fs-extra';
import { inject } from 'inversify';
import { Logger } from 'winston';

import { parser } from '../Utils/Parser';
import { Settings } from '../Utils/Settings';

@command('update')
export default class Update extends Command {
    @inject('Settings')
    private readonly settings!: Settings;

    @inject('Logger')
    private readonly logger!: Logger;

    static description = 'Update the typescript meta-model interface';

    public static readonly flags: Interfaces.FlagInput<Record<string, unknown>> = {
        source: Flags.string({
            char: 's',
            default: '',
            description: 'Path to the typescript meta-model from pharo json file',
            required: true,
        }),
    };

    public static readonly args: Interfaces.ArgInput = [
        {
            description: 'Which option to update',
            name: 'options',
            options: ['interface', 'meta-model'],
            required: true,
        },
    ];

    public readonly run = async (): Promise<void> => {
        const { args, flags } = await this.parse(Update);

        if (args.options === 'meta-model') {
            await this.copy(flags.source as string);
        }

        await this.updateInterface();
    };

    private readonly copy = async (source: string): Promise<void> => {
        await fs.copy(source, this.settings.getTyped('pharo').destination, { overwrite: true });
        this.logger.info(`Updated meta-model from ${source} to ${this.settings.getTyped('pharo').destination}`);
    };

    private readonly updateInterface = async () => {
        const options = this.settings.getTyped('pharo').interface;
        const encoding = { encoding: 'utf8' };

        const sample = await fs.readJson(this.settings.getTyped('pharo').destination, encoding);
        const { lines } = await parser.json({ name: options.name, samples: [JSON.stringify(sample)] });

        await fs.outputFile(options.path, lines.join('\n'), encoding);
        this.logger.info(`Updated ${options.name} interface`);
    };
}
