# Contributing to Keytune

Thanks for helping! Bug reports, hardware reports and pull requests are all welcome.

## Reporting a keyboard

The most useful thing right now is hearing how Keytune behaves on real keyboards. When you open an issue, please include:

- the keyboard model and its USB vendor/product id (the Advanced page shows them),
- your OS and Keytune version,
- what you did, what you expected and what happened.

## Development

```sh
npm install
npm run check   # TypeScript
npm test        # vitest
npm run dev     # build and run the app
```

- Run `npm run check` and `npm test` before opening a pull request; CI runs both.
- Protocol changes should come with a simulator change and a test. `src/shared/simulator.ts` is written from the firmware's C handlers, independently of the client code, so a test catches byte-offset mistakes on either side.
- Match the style of the surrounding code: small functions, comments only where the reason isn't obvious, plain-English interface text.
- Keytune never flashes firmware. Please keep it that way.

## Licence

By contributing you agree that your contribution is licensed under the GNU General Public License v3.0 or later, the same as the project.
