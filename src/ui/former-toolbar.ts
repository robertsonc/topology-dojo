/*
 * The toolbar before the shell was rebuilt (proposal 0013, P1), as data for
 * the tests that check nothing it did was lost: the menu definitions' unit
 * test (src/ui/menus.test.ts) and the browser walk of the menus
 * (e2e/shell-menus.spec.ts). One list, so the two cannot drift apart.
 */

/** A control of the old toolbar, and the commands that it ran. */
export type FormerControl = readonly [string, readonly string[]];

/**
 * Every control of the toolbar before the shell was rebuilt, with the
 * commands that it ran (src/main.ts, the header template). A select's options
 * are listed one by one. A menu must offer each of these commands, so that
 * nothing the toolbar did is lost with it. `templateIds` are the starter
 * templates the old template picker listed, in its order.
 */
export function formerToolbar(
  templateIds: readonly string[],
): readonly FormerControl[] {
  return [
    ['#fNew', ['file.new']],
    ['#fSave', ['file.download']],
    ['#fOpen', ['file.open']],
    ['#fShare', ['file.share']],
    ['#tUndo', ['edit.undo']],
    ['#tRedo', ['edit.redo']],
    ['#fSvg', ['file.export.svg']],
    ['#fPng', ['file.export.png']],
    [
      '#fExport',
      [
        'file.export.pdfPage',
        'file.export.pdfAll',
        'file.export.flipbook',
        'file.export.drawio',
        'file.export.vsdx',
        'file.export.pptx',
        'file.export.pptxLayers',
        'file.export.mermaid',
        'file.export.copyPng',
        'file.export.svgSelection',
        'file.export.pngSelection',
      ],
    ],
    [
      '#fTemplate',
      [...templateIds.map((id) => `file.template.${id}`), 'file.generateSdwan'],
    ],
    ['#tGrid', ['view.toggleGrid']],
    ['#tSnap', ['view.toggleSnap']],
    ['#tCalm', ['view.toggleCalm']],
    ['#tBadges', ['view.toggleBadges']],
    ['#tDisplay', ['view.displaySettings']],
    // The toggle becomes the choice of the two themes.
    ['#tTheme', ['view.theme.dark', 'view.theme.light']],
    ['#tFit', ['view.fit']],
    ['#tPresent', ['view.present']],
    ['#tHelp', ['help.shortcuts']],
    ['#tDelete', ['edit.delete']],
    ['#tTidy', ['arrange.tidy']],
    ['#tBalance', ['arrange.balance']],
    [
      '#tLayout',
      [
        'arrange.layout.hierarchical',
        'arrange.layout.grid',
        'arrange.layout.circular',
        'arrange.layout.force',
      ],
    ],
    [
      '#tSelectBy',
      [
        'selection.sameType',
        'selection.sameColor',
        'selection.growConnected',
        'selection.invert',
        'selection.all',
      ],
    ],
    [
      '#alignGroup',
      [
        'arrange.alignLeft',
        'arrange.alignCenterH',
        'arrange.alignRight',
        'arrange.alignTop',
        'arrange.alignMiddleV',
        'arrange.alignBottom',
        'arrange.distributeH',
        'arrange.distributeV',
      ],
    ],
    ['#tSelect', ['tool.select']],
    ['#tLink', ['tool.link']],
    ['#tAnchor', ['tool.anchor']],
    ['#profileChip', ['account.preferences']],
    ['#adminChip', ['account.admin']],
    ['#userChip', ['account.apiKeys', 'account.signOut']],
  ];
}
