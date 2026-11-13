import type { Meta, StoryObj } from '@storybook/react-vite';
import { NodeDetails, type NodeDetailsData } from './NodeDetails';

const list = <T,>(items: T[], total = items.length) => ({ items, total });
// Catalogue example content: Documenso's sendDocument, as the engine read it (phase 7).
const sendDocument: NodeDetailsData = {
  signature:
    '({ id, userId, teamId, sendEmail, requestMetadata }: SendDocumentOptions): Promise<Envelope>',
  params: list([
    {
      name: '{ id, userId, teamId, sendEmail, requestMetadata }',
      type: 'SendDocumentOptions',
      optional: false,
    },
  ]),
  returns: 'Promise<Envelope>',
  async: true,
  exported: true,
  decisions: list(
    [
      { kind: 'if', condition: '!envelope', outcomes: ['yes'], line: 106 },
      { kind: 'if', condition: 'envelope.recipients.length === 0', outcomes: ['yes'], line: 110 },
      {
        kind: 'if',
        condition: 'signingOrder === DocumentSigningOrder.SEQUENTIAL',
        outcomes: ['yes', 'no'],
        line: 153,
      },
      {
        kind: 'switch',
        condition: 'recipient.role',
        outcomes: ["case 'SIGNER'", "case 'VIEWER'", 'default'],
        line: 201,
      },
      { kind: 'catch', condition: 'on error', outcomes: ['error'], line: 290 },
    ],
    21,
  ),
  throws: list(
    [
      { text: "new Error('Document not found')", line: 107 },
      { text: "new Error('Document has no recipients')", line: 111 },
    ],
    8,
  ),
  awaits: list(
    [
      { text: 'assertUserNotDisabledById', line: 60 },
      { text: 'prisma.envelope.findFirst', line: 69 },
      { text: 'prisma.documentMeta.update', line: 137 },
    ],
    19,
  ),
  unresolved: list(
    [
      { text: 'prisma.envelope.findFirst', lines: [69] },
      { text: 'prisma.documentMeta.update', lines: [137] },
    ],
    14,
  ),
  writes: list([]),
};

const meta = {
  title: 'Shell/Node details',
  component: NodeDetails,
  args: {
    details: sendDocument,
    path: 'packages/lib/server-only/document/send-document.ts',
    onOpenLine: () => undefined,
  },
  render: (args) => (
    <div style={{ width: 360 }}>
      <NodeDetails {...args} />
    </div>
  ),
} satisfies Meta<typeof NodeDetails>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Function: Story = {};
export const TopLevel: Story = {
  args: {
    details: {
      ...sendDocument,
      signature: null,
      params: list([]),
      returns: null,
      async: false,
      exported: false,
      decisions: list([]),
      throws: list([]),
      awaits: list([]),
      unresolved: list([{ text: 'redirect', lines: [4] }]),
    },
  },
};
