#!/usr/bin/env node

import {spawn} from 'child_process';
import blessed from 'blessed';
import {Buf, Diff, Error, Oid, Repository, Stash} from 'nodegit';

function checkPatch(patch: string) {
  return new Promise((resolve, reject) => {
    const p = spawn('git', ['apply', '--check']);
    p.on('close', code => {
      if (code === 0) resolve();
      else reject();
    });
    p.stdin.write(patch);
    p.stdin.end();
  });
}

async function go() {
  const screen = blessed.screen({
    smartCSR: true,
  });

  const cwd = process.cwd();
  const stashes: [string, Oid][] = [];
  const repo = await Repository.open(cwd);
  await Stash.foreach(repo, (id: number, msg: string, oid: Oid) => {
    stashes.push([msg, oid]);
    return 0;
  });
  if (stashes.length === 0) {
    console.log('No stashes in current git repo');
    process.exit(0);
  } else {
    const stashlist = blessed.list({
      top: 0,
      left: 0,
      right: 0,
      height: 5,
      vi: true,
      keys: true,
      mouse: true,
      items: stashes.map(([msg, oid], i) => `{${i}}: ${msg}`),
      scrollable: true,

      style: {
        selected: {
          bg: 'lightgrey',
          fg: 'black',
        },
      },
    });
    screen.append(stashlist);

    const stashpreview = blessed.box({
      top: 5,
      left: 0,
      bottom: 2,
      right: 0,
      shrink: true,
      border: 'line',
      mouse: true,
      scrollable: true,
      alwaysScroll: true,
      scrollbar: {
        style: {
          bg: 'white',
        },
        track: {
          bg: 'grey',
        },
      },
    });
    screen.append(stashpreview);

    const commands = blessed.box({
      bottom: 0,
      height: 2,
      left: 0,
      right: 0,
    });
    commands.append(
      blessed.text({
        top: 0,
        left: 0,
        align: 'left',
        content: 'd - drop',
      }),
    );
    commands.append(
      blessed.text({
        bottom: 0,
        left: 0,
        align: 'left',
        content: '? - toggle help',
      }),
    );
    commands.append(
      blessed.text({
        top: 0,
        right: 0,
        content: 'q - quit',
      }),
    );
    commands.append(
      blessed.text({
        bottom: 0,
        right: 0,
        content: 'j/k - move',
      }),
    );
    const apply = blessed.text({
      top: 0,
      left: 'center',
      content: 'a - apply',
    });
    commands.append(apply);
    const pop = blessed.text({
      bottom: 0,
      left: 'center',
      content: 'p - pop',
    });
    commands.append(pop);
    screen.append(commands);

    const adjustText = (clean: boolean) => {
      if (clean) {
        apply.content = 'a - apply';
        pop.content = 'p - pop';
      } else {
        apply.content = 'a - apply & exit';
        pop.content = '(conflicts found)';
      }
    };

    let selectedStash = 0;
    let clean = false;
    const selectStash = async (_: unknown, i: number) => {
      selectedStash = i;
      const [msg, oid] = stashes[i];
      const commit = await repo.getCommit(oid);
      const [diff] = await commit.getDiff();
      const buf = await diff.toBuf(Diff.FORMAT.PATCH);
      const patch = buf.toString();
      if (patch === '') {
        stashpreview.setContent('Empty stash');
        stashpreview.style.border.fg = 'green';
        adjustText(true);
      } else {
        stashpreview.setContent(patch);

        try {
          await checkPatch(patch);
          clean = true;
          stashpreview.style.border.fg = 'green';
          adjustText(true);
        } catch (e) {
          stashpreview.style.border.fg = 'red';
          clean = false;
          adjustText(false);
        }
      }
      screen.render();
    };
    stashlist.on('select item', selectStash);
    selectStash(0, 0);
    const error = blessed.message({
      top: 'center',
      left: 'center',
      width: '50%',
      height: '50%',
      border: 'line',
      align: 'center',
      valign: 'middle',
    });
    error.hide();
    screen.append(error);

    screen.key(['pageup'], () => {
      stashpreview.scroll(-3);
      screen.render();
    });
    screen.key(['pagedown'], () => {
      stashpreview.scroll(3);
      screen.render();
    });
    screen.key(['d'], async () => {
      try {
        const res = await Stash.drop(repo, selectedStash);
        if (res === 0 || res === undefined) {
          stashlist.spliceItem(selectedStash, 1);
          stashes.splice(selectedStash, 1);
          selectStash(0, Math.min(selectedStash, stashes.length - 1));
          screen.render();
        } else if (res === Error.CODE.ENOTFOUND) {
          error.error(`Problem dropping stash (not found)`, 0, () => {});
        } else {
          error.error(
            `Unknown problem dropping stash (error: ${res})`,
            0,
            () => {},
          );
        }
      } catch (e) {
        error.error(e.message, 0, () => {});
        screen.render();
      }
    });
    screen.key(['?'], () => {
      if (commands.visible) {
        commands.hide();
        stashpreview.bottom = 0;
      } else {
        commands.show();
        stashpreview.bottom = 2;
      }
      screen.render();
    });
    screen.key(['a'], async () => {
      await Stash.apply(repo, selectedStash);
      if (!clean) {
        return process.exit(0);
      }
      selectStash(0, selectedStash);
    });
    screen.key(['p'], async () => {
      if (clean) {
        const res = await Stash.pop(repo, selectedStash);
        if (res !== 0 && res !== undefined) {
          console.error('Stash did not apply cleanly');
          return process.exit(1);
        }
        stashlist.spliceItem(selectedStash, 1);
        stashes.splice(selectedStash, 1);
        selectStash(0, Math.min(selectedStash, stashes.length - 1));
        screen.render();
      }
    });
    screen.key(['escape', 'q', 'C-c'], () => {
      return process.exit(0);
    });

    screen.render();
    stashlist.focus();
  }
}

go();
