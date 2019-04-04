import inquirer, {Questions} from 'inquirer';
import {Repository, Stash} from 'nodegit';

async function go() {
  const cwd = process.cwd();
  const repo = await Repository.open(cwd);
  const stashes: Stash[] = [];
  await Stash.foreach(repo, (s: Stash) => stashes.push(s));
  if (stashes.length === 0) {
    console.log('No stashes in current git repo');
  } else {
    inquirer.prompt([
      {
        type: 'rawlist',
        choices: stashes,
      },
    ]);
  }
}

go();
