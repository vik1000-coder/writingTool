"""Illustrative plotting code. The indexer reads the AST; it never executes it."""
import csv


def plot_beta_sweep():
    """Read synthetic ESS data and identify the existing visualization output."""
    source = 'results/beta_sweep.csv'
    output = 'figures/beta_sweep.svg'
    with open(source, newline='') as stream:
        rows = list(csv.DictReader(stream))
    return rows, output
