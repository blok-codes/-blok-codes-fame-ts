/* eslint-disable @typescript-eslint/no-explicit-any */
import { createDynamicInstance, isInstanceOf } from '../helpers';
import { FamixBaseElement } from './FamixBaseElement';
import { FamixMSEExporter } from './FamixMSEExporter';

interface Class {
    getMSE(): string;

    addPropertiesToExporter(exporter: FamixMSEExporter): void;
}

export class FamixRepository {
    private classes: Set<Class> = new Set<Class>();
    private elements: Set<FamixBaseElement> = new Set<FamixBaseElement>();

    private counter = 1;
    private static instance: FamixRepository;

    public static readonly getInstance = (): FamixRepository => {
        if (!FamixRepository.instance) {
            FamixRepository.instance = new FamixRepository();
        }

        return FamixRepository.instance;
    };

    public static readonly clear = (): void => {
        this.instance = new FamixRepository();
    };

    // TODO: what's the implication for Traits?
    public readonly createOrGetFamixClass = (name: string, isInterface?: boolean): Class => {
        let instance = this.getFamixClass(name);

        if (!instance) {
            instance = createDynamicInstance<Class>(this, 'Class');

            // TODO: why do we need this?
            (instance as any).name = name.toLowerCase();
            (instance as any).isStub = true;
            (instance as any).isInterface = isInterface;
        }

        return instance;
    };

    public readonly getFamixClass = (name: string): Class | undefined => {
        for (const clazz of this.classes) {
            if ((clazz as any).getName().toLowerCase() === name.toLowerCase()) {
                return clazz;
            }
        }

        return undefined;
    };

    public readonly addElement = (element: FamixBaseElement): void => {
        if (isInstanceOf<Class>(element, ['getMSE', 'addPropertiesToExporter'])) {
            this.classes.add(element);
        } else {
            this.elements.add(element);
        }

        element.id = ++this.counter;
    };

    public readonly getMSE = (): string => {
        let mse = '(';

        for (const clazz of this.classes) {
            mse += clazz.getMSE();
        }

        for (const element of this.elements) {
            mse += element.getMSE();
        }

        return mse + ')';
    };
}
