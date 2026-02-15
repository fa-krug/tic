# Global Command Bar Design

## Overview

Extend the unified command bar to work across all list screens and search across items, PRs, and branches. Move branch data into backendDataStore.

## Changes

### 1. Branch data in backendDataStore
Add branches/branchesLoading to store. loadBranches and refreshBranches methods. BranchRow type to shared location.

### 2. Navigation store highlight targets
Add selectedPrId/selectedBranchName with actions. Reset on navigate.

### 3. CommandBar component
Extract from WorkItemList. Searches Recent, Commands, Issues, PRs, Branches. Uses OverlayPanel with externalFilter.

### 4. Screen integration
All list screens get / keybinding with CommandBar. BranchList removes custom search and local data loading.

### 5. Selection behavior
Command executes callback. Issue/PR/Branch navigate to respective list and highlight.
