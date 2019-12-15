import { ClassNode } from "./src/elements/class-node";
import { GetterNode } from "./src/elements/getter-node";
import { InterfaceNode } from "./src/elements/interface-node";
import { MethodNode } from "./src/elements/method-node";
import { PropertyNode } from "./src/elements/property-node";
import { SetterNode } from "./src/elements/setter-node";
import { UnknownNode } from "./src/elements/unknown-node";
import { formatLines, removeRegions } from "./src/regions";
import { Transformer } from "./src/transformer";
import { compareNumbers, getClasses, getEnums, getFunctions, getImports, getInterfaces, getTypeAliases } from "./src/utils";
import * as ts from "typescript";
import * as vscode from "vscode";
import { ElementNode } from "./src/elements/element-node";

export function activate(context: vscode.ExtensionContext)
{
    context.subscriptions.push(vscode.commands.registerCommand('tsco.organize', () => organize(vscode.window.activeTextEditor, getUseRegionsConfig(), getAddPublicModifierIfMissing(), getAddRegionIdentationConfig(), getAddRegionCaptionToRegionEnd(), getGroupPropertiesByDecorators())));
    context.subscriptions.push(vscode.commands.registerCommand('tsco.organizeAll', () => organizeAll(getUseRegionsConfig(), getAddPublicModifierIfMissing(), getAddRegionIdentationConfig(), getAddRegionCaptionToRegionEnd(), getGroupPropertiesByDecorators(), getFilesToInclude(), getFilesToExclude())));
}

function getUseRegionsConfig(): boolean
{
    return vscode.workspace.getConfiguration("tsco").get<boolean>("useRegions") === true;
}

function getAddPublicModifierIfMissing(): boolean
{
    return vscode.workspace.getConfiguration("tsco").get<boolean>("addPublicModifierIfMissing") === true;
}

function getAccessorsBeforeCtor(): boolean
{
    return vscode.workspace.getConfiguration("tsco").get<boolean>("accessorsBeforeCtor") === true;
}

function getAddRowNumberInRegionName(): boolean
{
    return vscode.workspace.getConfiguration("tsco").get<boolean>("addRowNumberInRegionName") === true;
}
function getAddRegionIdentationConfig(): boolean
{
    return vscode.workspace.getConfiguration("tsco").get<boolean>("addRegionIdentation") === true;
}

function getAddRegionCaptionToRegionEnd(): boolean
{
    return vscode.workspace.getConfiguration("tsco").get<boolean>("addRegionCaptionToRegionEnd") === true;
}

function getGroupPropertiesByDecorators(): boolean
{
    return vscode.workspace.getConfiguration("tsco").get<boolean>("groupPropertiesWithDecorators") === true;
}

function getFilesToInclude(): string
{
    return vscode.workspace.getConfiguration("tsco").get<string>("filesToInclude") || "**/*.ts";
}

function getFilesToExclude(): string
{
    return vscode.workspace.getConfiguration("tsco").get<string>("filesToExclude") || "**/node_modules/**";
}

function getIdentation(sourceCode: string): string
{
    let tab = "\t";
    let twoSpaces = "  ";
    let fourSpaces = "    ";

    for (const sourceCodeLine of sourceCode.split("\n"))
    {
        if (sourceCodeLine.startsWith(tab))
        {
            return tab;
        }
        else if (sourceCodeLine.startsWith(fourSpaces))
        {
            return fourSpaces;
        }
        else if (sourceCodeLine.startsWith(twoSpaces))
        {
            return twoSpaces;
        }
    }

    return twoSpaces;
}

function organizeAll(useRegions: boolean, addPublicModifierIfMissing: boolean, addIdentation: boolean, addRegionCaptionToRegionEnd: boolean, groupPropertiesWithDecorators: boolean, filesToInclude: string, filesToExclude: string) {
    let fileStack = new Array<vscode.Uri>();
    let processNextStackItem = () => {
        if (fileStack.length) {
            let typescriptFile = fileStack.pop();
            if (typescriptFile !== undefined) {
                vscode.workspace.openTextDocument(typescriptFile)
                    .then(document => vscode.window.showTextDocument(document)
                        .then(editor => {
                            organize(editor, useRegions, addPublicModifierIfMissing, addIdentation, addRegionCaptionToRegionEnd, groupPropertiesWithDecorators);
                            processNextStackItem();
                        }));
            }
        }
    };
    vscode.workspace.findFiles(filesToInclude, filesToExclude)
        .then(typescriptFiles => {
            fileStack = typescriptFiles.slice();
            processNextStackItem();
        });
}

function organize(editor: vscode.TextEditor | undefined, useRegions: boolean, addPublicModifierIfMissing: boolean, addRegionIdentation: boolean, addRegionCaptionToRegionEnd: boolean, groupElementsWithDecorators: boolean)
{
    let edit: vscode.WorkspaceEdit;
    let start: vscode.Position;
    let end: vscode.Position;
    let range: vscode.Range;

    if (editor)
    {
        let sourceCode = editor.document.getText();
        let fileName = editor.document.fileName;

        sourceCode = organizeCode(sourceCode, fileName, useRegions, addPublicModifierIfMissing, addRegionIdentation, addRegionCaptionToRegionEnd, groupElementsWithDecorators);

        start = new vscode.Position(0, 0);
        end = new vscode.Position(editor.document.lineCount, editor.document.lineAt(editor.document.lineCount - 1).text.length);
        range = new vscode.Range(start, end);

        edit = new vscode.WorkspaceEdit();
        edit.replace(editor.document.uri, range, sourceCode);

        return vscode.workspace.applyEdit(edit);
    }
}

function print(groups: any, sourceCode: string, start: number, end: number, identationLevel: number, addPublicModifierIfMissing: boolean, addRegionIdentation: boolean, identation: string, addRegionCaptionToRegionEnd: boolean, groupElementsWithDecorators: boolean)
{
    let sourceCode2: string;
    let count;
    let members = "";
    let newLine = "\r\n";

    for (let group of groups)
    {
        count = 0;

        for (let group2 of group.groups)
        {
            count += group2.nodes.length;
        }

        if (count > 0)
        {
            if (group.regions)
            {
                members += newLine;
                members += `${addRegionIdentation ? identation : ""}// #region ${group.description}`;
                if(getAddRowNumberInRegionName()) {
                    members += ` (${count})`;
                }
                members += newLine;
            }

            members += newLine;

            for (let group2 of group.groups)
            {
                let lastNode: ElementNode | null = null;
                for (let i = 0; i < group2.nodes.length; i++)
                {
                    const node = group2.nodes[i];
                    let comment = sourceCode.substring(node.fullStart, node.start).trim();
                    let code = sourceCode.substring(node.start, node.end).trim();
                    if (code.endsWith("}") && 
                        lastNode != null && lastNode.name != node.name)
                    {
                        members += newLine;
                    }
                    if (addPublicModifierIfMissing)
                    {
                        if (node instanceof MethodNode ||
                            node instanceof PropertyNode ||
                            node instanceof GetterNode ||
                            node instanceof SetterNode)
                        {
                            if (node.accessModifier === null)
                            {
                                const prefixes = ["static", "async", "get", "set", "readonly", "abstract\s+get", "abstract\s+set", "abstract"];
                                let done = false;
                                for (let i = 0; i < prefixes.length; i++) {
                                    let newCode = code.replace(new RegExp(`${prefixes[i]}\s+${node.name}`), `public ${prefixes[i]} ${node.name}`);
                                    if(newCode.length > code.length){
                                        code = newCode;
                                        done = true;
                                        break;
                                    }
                                }
                                if(!done)
                                {
                                    code = code.replace(`${node.name}:`, `public ${node.name}:`);
                                    code = code.replace(`${node.name} =`, `public ${node.name} =`);
                                    code = code.replace(`${node.name};`, `public ${node.name};`);
                                    code = code.replace(`${node.name}(`, `public ${node.name}(`);
                                }
                            }
                        }
                    }

                    if (groupElementsWithDecorators)
                    {
                        if (i > 0)
                        {
                            if (group2.nodes[i - 1].decorators.length > 0 &&
                                group2.nodes[i].decorators.length === 0)
                            {
                                members += newLine;
                            }
                        }
                    }

                    if (comment !== "")
                    {
                        members += `${identationLevel === 1 ? identation : ""}${comment}${newLine}`;
                    }

                    members += `${identationLevel === 1 ? identation : ""}${code}`;
                    members += newLine;
                    
                    lastNode = node;
                }

                members += newLine;
            }

            if (group.regions)
            {
                members += newLine;

                if (addRegionCaptionToRegionEnd)
                {
                    members += `${addRegionIdentation ? identation : ""}// #endregion ${group.description}`;
                    if(getAddRowNumberInRegionName()) {
                        members += ` (${count})`;
                    }
                    members += newLine;
                }
                else
                {
                    members += `${addRegionIdentation ? identation : ""}// #endregion${newLine}`;
                }
            }

            members += newLine;
        }
    }

    sourceCode2 = sourceCode.substring(0, start).trimRight();
    sourceCode2 += newLine;
    sourceCode2 += (addRegionIdentation ? identation : "") + members.trim();
    sourceCode2 += newLine;
    sourceCode2 += sourceCode.substring(end, sourceCode.length).trimLeft();

    return sourceCode2.trimLeft();
}

function organizeCode(sourceCode: string, fileName: string, useRegions: boolean, addPublicModifierIfMissing: boolean, addRegionIdentation: boolean, addRegionCaptionToRegionEnd: boolean, groupElementsWithDecorators: boolean)
{
    sourceCode = removeRegions(sourceCode);

    let identation = getIdentation(sourceCode);

    // organize type aliases, interfaces, classes, enums, functions and variables
    let sourceFile = ts.createSourceFile(fileName, sourceCode, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);

    let elements = new Transformer().analyzeSyntaxTree(sourceFile);

    if (!elements.some(x => !(x instanceof UnknownNode)))
    {
        let imports = getImports(elements, groupElementsWithDecorators);
        let functions = getFunctions(elements, groupElementsWithDecorators);
        let typeAliases = getTypeAliases(elements, groupElementsWithDecorators);
        let interfaces = getInterfaces(elements, groupElementsWithDecorators);
        let classes = getClasses(elements, groupElementsWithDecorators);
        let enums = getEnums(elements, groupElementsWithDecorators);

        let groups = [
            { description: "Imports", groups: [{ nodes: imports }], regions: false },
            { description: "Type aliases", groups: [{ nodes: typeAliases }], regions: true },
            { description: "Interfaces", groups: [{ nodes: interfaces }], regions: true },
            { description: "Classes", groups: [{ nodes: classes }], regions: true },
            { description: "Enums", groups: [{ nodes: enums }], regions: true },
            { description: "Functions", groups: [{ nodes: functions }], regions: true }
        ];

        if (functions.length + typeAliases.length + interfaces.length + classes.length + enums.length > 1 ||
            functions.length > 0)
        {
            sourceCode = print(groups, sourceCode, 0, sourceCode.length, 0, false, false, identation, addRegionCaptionToRegionEnd, groupElementsWithDecorators);
        }
    }

    // organize members of interfaces and classes
    sourceFile = ts.createSourceFile(fileName, sourceCode, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);

    elements = new Transformer().analyzeSyntaxTree(sourceFile);

    for (let element of elements.sort((a, b) => compareNumbers(a.fullStart, b.fullStart) * -1))
    {
        if (element instanceof InterfaceNode)
        {
            let interfaceNode = <InterfaceNode>element;
            let groups = [
                {
                    description: "Properties",
                    groups: [
                        { nodes: interfaceNode.getConstProperties(groupElementsWithDecorators) },
                        { nodes: interfaceNode.getReadOnlyProperties(groupElementsWithDecorators) },
                        { nodes: interfaceNode.getProperties(groupElementsWithDecorators) }
                    ],
                    regions: true
                },
                { description: "Indexes", groups: [{ nodes: interfaceNode.getIndexes(groupElementsWithDecorators) }], regions: true },
                { description: "Methods", groups: [{ nodes: interfaceNode.getMethods(groupElementsWithDecorators) }], regions: true }
            ];

            sourceCode = print(groups, sourceCode, interfaceNode.membersStart, interfaceNode.membersEnd, 1, false, addRegionIdentation, identation, addRegionCaptionToRegionEnd, groupElementsWithDecorators);
        }
        else if (element instanceof ClassNode)
        {
            let classNode = <ClassNode>element;
            let propertyMap = new Map<string, ElementNode[]>();
            for(let property of classNode.getters.concat(classNode.setters))
            {
                if(!propertyMap.has(property.name)) {
                    propertyMap.set(property.name, []);
                }
                let mapping = propertyMap.get(property.name);
                if(mapping != null)
                {
                    mapping.push(property);
                }
            }
            for(let propertyGroup of propertyMap.entries())
            {
                let propertyNodes = propertyGroup[1];
                let decorators = new Array<string>();
                for(let propertyNode of propertyNodes)
                {
                    for(let decorator of propertyNode.decorators) 
                    {
                        if(decorators.indexOf(decorator) == -1)
                        {
                            decorators.push(decorator);
                        }
                    }
                }
                for(let propertyNode of propertyNodes)
                {
                    propertyNode.decorators = decorators;
                }
            }
            let groups = [
                {
                    description: "Properties",
                    groups: [
                        { nodes: classNode.getPrivateStaticConstProperties(groupElementsWithDecorators) },
                        { nodes: classNode.getPrivateConstProperties(groupElementsWithDecorators) },
                        { nodes: classNode.getPrivateStaticReadOnlyProperties(groupElementsWithDecorators) },
                        { nodes: classNode.getPrivateReadOnlyProperties(groupElementsWithDecorators) },
                        { nodes: classNode.getPrivateStaticProperties(groupElementsWithDecorators) },
                        { nodes: classNode.getPrivateProperties(groupElementsWithDecorators) },

                        { nodes: classNode.getProtectedStaticConstProperties(groupElementsWithDecorators) },
                        { nodes: classNode.getProtectedConstProperties(groupElementsWithDecorators) },
                        { nodes: classNode.getProtectedStaticReadOnlyProperties(groupElementsWithDecorators) },
                        { nodes: classNode.getProtectedReadOnlyProperties(groupElementsWithDecorators) },
                        { nodes: classNode.getProtectedStaticProperties(groupElementsWithDecorators) },
                        { nodes: classNode.getProtectedProperties(groupElementsWithDecorators) },

                        { nodes: classNode.getPublicStaticConstProperties(groupElementsWithDecorators) },
                        { nodes: classNode.getPublicConstProperties(groupElementsWithDecorators) },
                        { nodes: classNode.getPublicStaticReadOnlyProperties(groupElementsWithDecorators) },
                        { nodes: classNode.getPublicReadOnlyProperties(groupElementsWithDecorators) },
                        { nodes: classNode.getPublicStaticProperties(groupElementsWithDecorators) },
                        { nodes: classNode.getPublicProperties(groupElementsWithDecorators) }
                    ],
                    regions: true
                },

                { description: "Constructors", groups: [{ nodes: classNode.getConstructors(groupElementsWithDecorators) }], regions: true },

               
                { description: "Public Static Indexes", groups: [{ nodes: classNode.getPublicStaticIndexes(groupElementsWithDecorators) }], regions: true },
                { description: "Public Indexes", groups: [{ nodes: classNode.getPublicIndexes(groupElementsWithDecorators) }], regions: true },
                { description: "Public Abstract Indexes", groups: [{ nodes: classNode.getPublicAbstractIndexes(groupElementsWithDecorators) }], regions: true },

                { description: "Protected Static Indexes", groups: [{ nodes: classNode.getProtectedStaticIndexes(groupElementsWithDecorators) }], regions: true },
                { description: "Protected Indexes", groups: [{ nodes: classNode.getProtectedIndexes(groupElementsWithDecorators) }], regions: true },
                { description: "Protected Abstract Indexes", groups: [{ nodes: classNode.getProtectedAbstractIndexes(groupElementsWithDecorators) }], regions: true },

                { description: "Private Static Indexes", groups: [{ nodes: classNode.getPrivateStaticIndexes(groupElementsWithDecorators) }], regions: true },
                { description: "Private Indexes", groups: [{ nodes: classNode.getPrivateIndexes(groupElementsWithDecorators) }], regions: true },
                { description: "Private Abstract Indexes", groups: [{ nodes: classNode.getPrivateAbstractIndexes(groupElementsWithDecorators) }], regions: true },

                { description: "Public Static Methods", groups: [{ nodes: classNode.getPublicStaticMethods(groupElementsWithDecorators) }], regions: true },
                { description: "Public Methods", groups: [{ nodes: classNode.getPublicMethods(groupElementsWithDecorators) }], regions: true },
                { description: "Public Abstract Methods", groups: [{ nodes: classNode.getPublicAbstractMethods(groupElementsWithDecorators) }], regions: true },

                { description: "Protected Static Methods", groups: [{ nodes: classNode.getProtectedStaticMethods(groupElementsWithDecorators) }], regions: true },
                { description: "Protected Methods", groups: [{ nodes: classNode.getProtectedMethods(groupElementsWithDecorators) }], regions: true },
                { description: "Protected Abstract Methods", groups: [{ nodes: classNode.getProtectedAbstractMethods(groupElementsWithDecorators) }], regions: true },

                { description: "Private Static Methods", groups: [{ nodes: classNode.getPrivateStaticMethods(groupElementsWithDecorators) }], regions: true },
                { description: "Private Methods", groups: [{ nodes: classNode.getPrivateMethods(groupElementsWithDecorators) }], regions: true },
                { description: "Private Abstract Methods", groups: [{ nodes: classNode.getPrivateAbstractMethods(groupElementsWithDecorators) }], regions: true },
            ];

            const constructorIndex=1;
            let accessorIndex = getAccessorsBeforeCtor()
                ? constructorIndex
                : constructorIndex +1;

            putAccessorAt(groups, classNode, groupElementsWithDecorators, accessorIndex);
            sourceCode = print(groups, sourceCode, classNode.membersStart, classNode.membersEnd, 1, addPublicModifierIfMissing, addRegionIdentation, identation, addRegionCaptionToRegionEnd, groupElementsWithDecorators);
        }
    }

    if (!useRegions)
    {
        sourceCode = removeRegions(sourceCode);
    }

    sourceCode = formatLines(sourceCode);
    return sourceCode;
}


function putAccessorAt(groups:any,classNode:ClassNode, groupElementsWithDecorators: boolean, index: number){
    
    var accessorsItems = [ 
        { description: "Public Static Accessors", groups: [{ nodes: classNode.getPublicStaticGettersAndSetters(groupElementsWithDecorators) }], regions: true },
        { description: "Public Accessors", groups: [{ nodes: classNode.getPublicGettersAndSetters(groupElementsWithDecorators) }], regions: true },
        { description: "Public Abstract Accessors", groups: [{ nodes: classNode.getPublicAbstractGettersAndSetters(groupElementsWithDecorators) }], regions: true },

        { description: "Protected Static Accessors", groups: [{ nodes: classNode.getProtectedStaticGettersAndSetters(groupElementsWithDecorators) }], regions: true },
        { description: "Protected Accessors", groups: [{ nodes: classNode.getProtectedGettersAndSetters(groupElementsWithDecorators) }], regions: true },
        { description: "Protected Abstract Accessors", groups: [{ nodes: classNode.getProtectedAbstractGettersAndSetters(groupElementsWithDecorators) }], regions: true },

        { description: "Private Static Accessors", groups: [{ nodes: classNode.getPrivateStaticGettersAndSetters(groupElementsWithDecorators) }], regions: true },
        { description: "Private Accessors", groups: [{ nodes: classNode.getPrivateGettersAndSetters(groupElementsWithDecorators) }], regions: true },
        { description: "Private Abstract Accessors", groups: [{ nodes: classNode.getPrivateAbstractGettersAndSetters(groupElementsWithDecorators) }], regions: true },
    ];

    (accessorsItems).forEach(element => {
        groups.splice(index, 0, element)
        index++;
    });
}