import type { DemoScript } from '@x10/shared/demo';

const ROBIN = 'demo-duty-robin';

export const script: DemoScript = {
  title: 'Snow Day: snow closure calls from the forecast, with a record',
  persona: ROBIN,
  scenes: [
    {
      id: 'hook',
      say: [
        'Day ten of the twelve days of Fabric Apps: a snow globe that decides who stays home.',
        'At five in the morning someone calls a snow day from a weather app and a hunch, and nobody writes down why.',
      ],
      async run(h) {
        await h.goto('/', ROBIN);
        await h.page.locator('[data-testid="globe-canvas"][data-ready="true"], [data-testid="globe-svg"]').first().waitFor({ timeout: 30_000 });
        await h.pause(6000);
      },
    },
    {
      id: 'globe',
      say: [
        'Every site is a building on its own hill, as high as the site; snow falls over each one at its forecast.',
        'The windows are the call: warm is open, dark is closed, and the faint flicker means nobody has called it yet.',
      ],
      async run(h) {
        await h.spotlight(h.page.getByRole('button', { name: /^Summit Primary,/ }).locator('.x-globe-chip'), 2500);
        await h.pause(2500);
        await h.spotlight(h.page.getByRole('button', { name: /^Ridge Road Clinic,/ }).locator('.x-globe-chip'), 2500);
      },
    },
    {
      id: 'dial',
      say: ['Turn the dial to tomorrow and the storm arrives: thirty-four centimetres on the ridge, and the rural roads disappear first.'],
      async run(h) {
        await h.click(h.page.getByRole('radiogroup', { name: 'Day' }).getByRole('radio').nth(1));
        await h.pause(4500);
        await h.click(h.page.getByRole('radiogroup', { name: 'Day' }).getByRole('radio').nth(0));
      },
    },
    {
      id: 'lens',
      say: ['The decision lens rings each hill with the call in force; four of ten sites are called so far.'],
      async run(h) {
        await h.click(h.page.getByRole('radiogroup', { name: 'Lens' }).getByRole('radio', { name: /Decision/ }));
        await h.pause(4000);
      },
    },
    {
      id: 'today',
      say: [
        'Today ranks what needs me before the nine o’clock lock.',
        'This one flies to Harbour Lane: closed at two percent, against the model, and the reason is on record.',
      ],
      async run(h) {
        await h.click(h.page.getByRole('button', { name: /Harbour Lane School: called closed/ }));
        await h.pause(3000);
        await h.spotlight(h.page.getByTestId('site-card-reason'), 2500);
      },
    },
    {
      id: 'view-as',
      say: ['A site lead sees their own sites, and the forecast they still owe.'],
      async run(h) {
        await h.click(h.page.getByTestId('site-card').getByRole('button', { name: 'Back to the whole globe' }));
        await h.click(h.page.getByRole('radiogroup', { name: 'View as' }).getByRole('radio', { name: 'Lead' }));
        await h.pause(3500);
        await h.click(h.page.getByRole('radiogroup', { name: 'View as' }).getByRole('radio', { name: 'Duty' }));
      },
    },
    {
      id: 'call',
      say: [
        'On The call, the model is a logistic regression fitted to our own past calls, and it shows what drives each number.',
        'Ridge Road Clinic is at ninety-two percent. If I open it anyway, that goes against the model by more than thirty-five points.',
        'So a two-word reason is refused; it needs thirty characters that say what the model cannot see.',
      ],
      async run(h) {
        await h.goto('/call');
        await h.click(h.page.getByTestId('call-row').filter({ hasText: 'Ridge Road Clinic' }));
        await h.spotlight(h.page.getByTestId('drivers'), 2500);
        const panel = h.page.getByTestId('call-panel');
        await h.click(panel.getByRole('radiogroup', { name: 'Call' }).getByRole('radio', { name: /^Open/ }));
        await h.type(panel.getByLabel('Reason'), 'Road gritted');
        await h.click(panel.getByRole('button', { name: 'Make the call' }));
        await h.pause(2500);
        await h.fill(panel.getByLabel('Reason'), 'Clinic road is on the hospital gritting route and was cleared at 04:00.');
        await h.click(panel.getByRole('button', { name: 'Make the call' }));
        await h.pause(2500);
      },
    },
    {
      id: 'lock',
      say: ['After nine the day is locked: a change becomes a revision, and the call it replaces stays in the record.'],
      async run(h) {
        await h.click(h.page.getByRole('radiogroup', { name: 'Day' }).getByRole('radio').first());
        await h.click(h.page.getByTestId('call-row').filter({ hasText: 'Summit Primary' }));
        await h.spotlight(h.page.getByTestId('call-history'), 3500);
      },
    },
    {
      id: 'hindsight',
      say: [
        'Hindsight scores every past call against what the day brought: ninety percent right, fifteen closures over-cautious.',
        'Next winter’s call starts from last winter’s record, not a hunch.',
      ],
      async run(h) {
        await h.goto('/hindsight');
        await h.spotlight(h.page.getByTestId('hit-rate'), 2500);
        await h.scrollTo(h.page.getByTestId('calibration'));
        await h.pause(3500);
      },
    },
  ],
};
