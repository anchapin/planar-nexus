import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

import {
  P2PStatusBanner,
  type P2PStatus,
} from '../p2p-status-banner';

describe('P2PStatusBanner', () => {
  it('renders the default "Coming Soon" status', () => {
    render(<P2PStatusBanner />);
    expect(
      screen.getByText(/P2P Multiplayer Coming Soon/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId('p2p-status-badge')).toHaveTextContent(
      'Coming Soon',
    );
  });

  it.each<[P2PStatus, string]>([
    ['unavailable', 'Unavailable'],
    ['coming-soon', 'Coming Soon'],
    ['in-development', 'In Development'],
  ])('renders the correct badge label for status "%s"', (status, label) => {
    render(<P2PStatusBanner status={status} />);
    expect(screen.getByTestId('p2p-status-badge')).toHaveTextContent(label);
  });

  it('renders custom title and description', () => {
    render(
      <P2PStatusBanner
        title="Custom Heading"
        description="Custom body copy explaining the state."
      />,
    );
    expect(
      screen.getByRole('heading', { name: /Custom Heading/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Custom body copy/i)).toBeInTheDocument();
  });

  it('hides the description in compact mode but keeps the status badge', () => {
    render(<P2PStatusBanner compact />);
    expect(
      screen.queryByText(/WebRTC peer-to-peer sync is not yet available/i),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('p2p-status-badge')).toHaveTextContent(
      'Coming Soon',
    );
  });

  it('renders the Learn More link pointing at the P2P docs by default', () => {
    render(<P2PStatusBanner />);
    const link = screen.getByTestId('p2p-learn-more-link');
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link.getAttribute('href')).toContain(
      'PHASE-4-5-P2P-NETWORKING-RESEARCH.md',
    );
  });

  it('honors a custom learnMoreUrl', () => {
    render(<P2PStatusBanner learnMoreUrl="https://example.com/roadmap" />);
    expect(screen.getByTestId('p2p-learn-more-link')).toHaveAttribute(
      'href',
      'https://example.com/roadmap',
    );
  });

  it('hides the Learn More link when learnMoreUrl is empty', () => {
    render(<P2PStatusBanner learnMoreUrl="" />);
    expect(screen.queryByTestId('p2p-learn-more-link')).not.toBeInTheDocument();
  });

  it('opens the link on click without throwing', async () => {
    const user = userEvent.setup();
    render(<P2PStatusBanner learnMoreUrl="https://example.com/p2p" />);
    const link = screen.getByTestId('p2p-learn-more-link');
    await user.click(link);
    // The anchor exists and is clickable; jsdom noop for navigation.
    expect(link).toHaveAttribute('href', 'https://example.com/p2p');
  });

  it('exposes a polite live region for assistive tech', () => {
    render(<P2PStatusBanner />);
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-live',
      'polite',
    );
  });

  it('applies a custom className', () => {
    const { container } = render(
      <P2PStatusBanner className="custom-class" />,
    );
    expect(container.firstChild).toHaveClass('custom-class');
  });
});
