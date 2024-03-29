import assert from 'assert';
import { inject, injectable } from 'inversify';
import { camelCase, uniqWith } from 'lodash';
import { ClassDeclaration, InterfaceDeclaration, Project, Scope, SourceFile } from 'ts-morph';
import { Logger } from 'winston';

import { Class, Property, RefEnum, TypescriptMetaModel } from './generated/TypescriptMetaModel';
import {
    addFamePropertyImportDeclaration,
    addFamixBaseElementImportDeclaration,
    addFamixJSONExporterImportDeclaration,
    addNamedImportDeclaration,
    addSetWithOppositeImportDeclaration,
    getAccessorsDefinitionTemplate,
    getSetWithOppositeTemplate,
    isRefEnum,
    toTsType,
} from './helpers';
import { Reference } from './Reference';

@injectable()
export class CodeGenerator {
    @inject('Logger')
    private readonly logger!: Logger;

    @inject('Project')
    private readonly project!: Project;

    @inject('Reference')
    private readonly reference!: Reference;

    public readonly generate = (): void => {
        const metamodels = this.reference.getMetaModels();
        this.reference.addAll(metamodels);

        metamodels.forEach((metamodel) => this.acceptPackage(metamodel));

        this.project.resolveSourceFileDependencies();
        this.project.saveSync();
    };

    private readonly acceptPackage = (metamodel: TypescriptMetaModel): void => {
        this.logger.info(`Package: ${metamodel.name}`);

        metamodel.classes.forEach((clazz) => {
            const path = this.reference.getEntityClassPath(clazz.id);
            const source = this.project.createSourceFile(`${path}.ts`, '', {
                overwrite: true,
            });

            if (clazz.FM3 === 'FM3.Trait') {
                this.acceptTrait(clazz, source);
            } else {
                this.acceptClass(clazz, source);
            }

            source.insertStatements(0, ['// This code is automagically generated from a metamodel using ts-morph']);
            source.formatText();
        });
    };

    private readonly acceptClass = (clazz: Class, source: SourceFile): void => {
        this.logger.info(`Class: ${clazz.name}`);

        const packageName = this.reference.getEntityName(clazz.package.ref);
        const hasSuperClass =
            clazz.superclass !== undefined && (packageName !== 'Moose' || clazz.name !== 'BaseObject');

        const classDeclaration = source.addClass({
            isExported: true,
            name: clazz.name,
        });

        let traits = clazz.traits;
        let properties = uniqWith(clazz.properties || [], (a, b) => a.name === b.name);

        if (hasSuperClass) {
            this.acceptSuperclass(clazz, source, classDeclaration);

            let superclass = clazz.superclass;
            const parentClasses: Class[] = [];

            while (superclass && superclass?.ref !== 'Object') {
                const entity = this.reference.getEntity(superclass.ref) as Class;
                parentClasses.push(entity);
                superclass = entity.superclass;
            }

            traits = traits?.filter(
                (trait) =>
                    !parentClasses.filter((superclass) => superclass.traits?.some((t) => t.ref === trait.ref)).length
            );

            properties = properties?.filter(
                (property) =>
                    !parentClasses.filter((superclass) => superclass.properties?.some((p) => p.name === property.name))
                        .length
            );
        }

        traits?.forEach((trait) => {
            classDeclaration.addImplements(this.addImportDeclaration(trait.ref, source));
            const entity = this.reference.getEntity(trait.ref) as Class;

            uniqWith(entity.properties || [], (a, b) => a.name === b.name)
                .sort((a, b) => a.name.localeCompare(b.name))
                .forEach((property) => properties.push(property));
        });

        if (clazz.name === 'BaseObject') {
            classDeclaration.setExtends('FamixBaseElement');
            addFamixBaseElementImportDeclaration(source);
        }

        addFamixJSONExporterImportDeclaration(source);
        const addPropertiesToExporterStatements: string[] = hasSuperClass
            ? ['super.addPropertiesToExporter(exporter);']
            : [];

        uniqWith(properties, (a, b) => a.name === b.name)
            .sort((a, b) => a.name.localeCompare(b.name))
            .forEach((property) => {
                this.acceptProperty(property, source, classDeclaration);

                addPropertiesToExporterStatements.push(
                    `exporter.addProperty("${property.name}", this.${property.name});`
                );
            });

        classDeclaration.addMethod({
            name: 'addPropertiesToExporter',
            parameters: [{ name: 'exporter', type: 'FamixJSONExporter' }],
            statements: addPropertiesToExporterStatements,
        });

        classDeclaration.addMethod({
            name: 'toJSON',
            statements: [
                `const exporter: FamixJSONExporter = new FamixJSONExporter("${packageName}.${clazz.name}", this);`,
                `this.addPropertiesToExporter(exporter);`,
                `return exporter.toJSON();`,
            ],
        });
    };

    private readonly acceptSuperclass = (
        clazz: Class,
        source: SourceFile,
        classDeclaration: ClassDeclaration
    ): void => {
        let superclass = this.reference.getEntityName(clazz.superclass.ref);
        let superclassPath = this.reference.getEntityClassBaseName(clazz.superclass.ref);

        if (clazz.name === 'Entity' && superclass === 'Entity') {
            this.logger.warning(`Fixing superclass of Entity to FamixBaseElement!`);
            superclassPath = superclass = 'FamixBaseElement';
        }

        this.logger.info(`   Class: ${clazz.name} extends superclass: ${superclass}, ref: ${clazz.superclass.ref}`);
        classDeclaration.setExtends(superclass);

        source.addImportDeclaration({
            moduleSpecifier: `../${superclassPath}`,
            namedImports: [superclass],
        });
    };

    private readonly acceptProperty = (
        property: Property,
        source: SourceFile,
        classDeclaration: ClassDeclaration
    ): void => {
        const typeName = isRefEnum(property.type.ref)
            ? toTsType(property.type.ref as string)
            : this.reference.getEntityName(property.type.ref);

        if (!isRefEnum(property.type.ref) && typeName !== classDeclaration.getName()) {
            this.addImportDeclaration(property.type.ref, source);
        }

        if (property.derived && !property.opposite) {
            this.acceptDerivedProperty(property, source, classDeclaration, typeName);
            return;
        }

        this.acceptAccessorProperty(property, source, classDeclaration, typeName);
    };

    private readonly acceptDerivedProperty = (
        property: Property,
        source: SourceFile,
        classDeclaration: ClassDeclaration,
        typeName: string
    ): void => {
        this.logger.info(`  Property: ${property.name}, id: ${property.id}, type.ref: ${property.type.ref}`);
        addFamePropertyImportDeclaration(source);

        if (this.reference.getEntityName(property.class.ref) !== classDeclaration.getName()) {
            this.addImportDeclaration(property.class.ref, source);
        }

        if (property.multivalued) {
            addSetWithOppositeImportDeclaration(source);
        }

        const accessorDeclaration = classDeclaration.addGetAccessor({
            name: `${property.name}`,
            returnType: property.multivalued ? `Set<${typeName}>` : typeName,
        });

        accessorDeclaration.addDecorator({
            arguments: [`{ name: "${property.name}", derived: ${property.derived}, container: ${property.container}}`],
            name: 'FameProperty',
        });

        accessorDeclaration.insertStatements(0, [
            `// @FameProperty(name = "${property.name}"${
                property.container ? ', derived = true, container = true' : ', derived = true'
            })`,
            '// TODO: this is a derived property; implement this method manually', // TODO: how to implement this?
            `throw new Error('Function not implemented.');`,
        ]);
    };

    private readonly acceptAccessorProperty = (
        property: Property,
        source: SourceFile,
        classDeclaration: ClassDeclaration,
        typeName: string
    ): void => {
        this.logger.info(`  Property: ${property.name}, id: ${property.id}, type.ref: ${property.type.ref}`);

        const propertyDeclaration = classDeclaration.addProperty({
            name: `_${property.name}${property.multivalued ? '' : '?'}`,
            scope: Scope.Private,
            type: property.multivalued ? `Set<${typeName}>` : typeName,
        });

        let oppositeName = '';
        let base = property.multivalued ? 'Many' : 'One';

        if (property.opposite) {
            const entity: Property = this.reference.getEntity(property.opposite.ref) as Property;

            oppositeName = entity.name;
            base += entity.multivalued ? 'Many' : 'One';
        }

        if (property.multivalued) {
            addSetWithOppositeImportDeclaration(source);
            const className = this.reference.getEntityName(property.class.ref);

            const template = getSetWithOppositeTemplate({
                base,
                className,
                oppositeName,
                typeName,
            });

            propertyDeclaration.setInitializer(template);
        }

        this.logger.info(
            `      accessorProperty: ${property.name}, isMultivalued: ${property.multivalued}, base: ${base}`
        );

        const { getAccessor, setAccessor } = getAccessorsDefinitionTemplate({
            base,
            multivalued: property.multivalued,
            oppositeName,
            propName: property.name,
            typeName,
        });

        classDeclaration.addGetAccessor(getAccessor);
        classDeclaration.addSetAccessor(setAccessor);

        if (property.multivalued) {
            classDeclaration.addMethod({
                name: camelCase(`add ${property.name}`),
                parameters: [{ name: camelCase(`the ${typeName}`), type: `${typeName}` }],
                returnType: 'void',
                statements: [`this._${property.name}.add(${camelCase(`the ${typeName}`)})`],
            });
        }
    };

    private readonly acceptTrait = (clazz: Class, source: SourceFile): void => {
        this.logger.info(`Interface: ${clazz.name}`);
        const interfaceDeclaration = source.addInterface({
            isExported: true,
            name: clazz.name,
        });

        assert(clazz.superclass === undefined, `Trait ${clazz.name} has a superclass defined.`);

        uniqWith(clazz.properties, (a, b) => a.name === b.name)
            ?.sort((a, b) => a.name.localeCompare(b.name))
            .forEach((property) => {
                this.acceptPropertyTrait(property, source, interfaceDeclaration);
            });
    };

    private readonly acceptPropertyTrait = (
        property: Property,
        source: SourceFile,
        interfaceDeclaration: InterfaceDeclaration
    ): void => {
        if (interfaceDeclaration.getProperty(property.name)) {
            return; // Property already exists
        }

        const typeName = isRefEnum(property.type.ref)
            ? toTsType(property.type.ref as string)
            : this.reference.getEntityName(property.type.ref);

        if (!isRefEnum(property.type.ref) && typeName !== interfaceDeclaration.getName()) {
            this.addImportDeclaration(property.type.ref, source);
        }

        if (property.derived && !property.opposite) {
            this.acceptDerivedPropertyTrait(property, source, interfaceDeclaration, typeName);
            return;
        }

        this.acceptAccessorPropertyTrait(property, source, interfaceDeclaration, typeName);
    };

    private readonly acceptDerivedPropertyTrait = (
        property: Property,
        source: SourceFile,
        interfaceDeclaration: InterfaceDeclaration,
        typeName: string
    ): void => {
        this.logger.info(`  Property: ${property.name}, id: ${property.id}, type.ref: ${property.type.ref}`);

        if (this.reference.getEntityName(property.class.ref) !== interfaceDeclaration.getName()) {
            this.addImportDeclaration(property.class.ref, source);
        }

        interfaceDeclaration.addProperty({
            name: property.name,
            type: property.multivalued ? `Set<${typeName}>` : typeName,
        });
    };

    private readonly acceptAccessorPropertyTrait = (
        property: Property,
        source: SourceFile,
        interfaceDeclaration: InterfaceDeclaration,
        typeName: string
    ): void => {
        this.logger.info(`  Property: ${property.name}, id: ${property.id}, type.ref: ${property.type.ref}`);

        if (property.type && this.reference.getEntityName(property.class.ref) !== interfaceDeclaration.getName()) {
            this.addImportDeclaration(property.class.ref, source);
        }

        interfaceDeclaration.addProperty({
            name: property.name,
            type: property.multivalued ? `Set<${typeName}>` : typeName,
        });
    };

    private readonly addImportDeclaration = (ref: number | RefEnum, source: SourceFile): string => {
        const name = this.reference.getEntityName(ref);
        const baseName = this.reference.getEntityClassBaseName(ref);

        const path = source.getFilePath().includes(baseName.replace(`/${name}`, '')) ? `./${name}` : `../${baseName}`;
        addNamedImportDeclaration(source, name, path);

        return name;
    };
}
