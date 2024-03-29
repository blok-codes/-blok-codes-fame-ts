import { SourceFile } from 'ts-morph';

/**
 * only add named import if it's not already there
 */
export const addNamedImportDeclaration = (source: SourceFile, name: string, path: string): void => {
    const imports = source.getImportDeclaration(path)?.getNamedImports() || [];

    if (imports.some((imported) => imported.getName() === name)) {
        return;
    }

    source.addImportDeclaration({ moduleSpecifier: path, namedImports: [name] });
};

export const addFameDescriptionImportDeclaration = (source: SourceFile): void => {
    addNamedImportDeclaration(source, 'FameDescription', '../Decorators');
};

export const addFamePropertyImportDeclaration = (source: SourceFile): void => {
    addNamedImportDeclaration(source, 'FameProperty', '../Decorators');
};

export const addFamixJSONExporterImportDeclaration = (source: SourceFile): void => {
    addNamedImportDeclaration(source, 'FamixJSONExporter', '../FamixJSONExporter');
};

export const addFamixBaseElementImportDeclaration = (source: SourceFile): void => {
    addNamedImportDeclaration(source, 'FamixBaseElement', '../FamixBaseElement');
};

export const addSetWithOppositeImportDeclaration = (source: SourceFile): void => {
    addNamedImportDeclaration(source, 'SetWithOpposite', '../SetWithOpposite');
};
